################################################################################
# ServHub-Mini --- Unified Automated Deployment Script with Elastic IP
# Run from: C:\Projects\ServHub-mini
#
# FIRST RUN:  .\deploy.ps1
# REDEPLOY:   .\deploy.ps1 -Resume   (skips infra, rebuilds images + dashboard only)
#
# AUTOMATED BY THIS SCRIPT:
#   - Auto-detects AWS Account ID from active CLI session
#   - Creates EC2 IAM Role + Instance Profile (No static AWS keys needed!)
#   - Creates S3 Bucket, SQS Queues (Main + DLQ), CloudWatch Log Groups
#   - Creates ECR Repositories, builds & pushes Docker images
#   - Launches EC2 instance & associates a permanent Elastic IP
#   - Installs Docker & Nginx, deploys apps with CloudWatch logging
#
# ONLY MANUAL STEP REMAINING:
#   Add/Update 2 A records in Cloudflare pointing to the printed Elastic IP!
################################################################################
param(
    [switch]$Resume   # Skip infra creation, just rebuild and redeploy
)

$ErrorActionPreference = "Stop"
$env:AWS_PAGER = ""

# ------ LOGGING HELPERS ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
function Log($msg)   { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg)    { Write-Host "    OK: $msg" -ForegroundColor Green }
function Warn($msg)  { Write-Host "    WARN: $msg" -ForegroundColor Yellow }
function Err($msg)   { Write-Host "`n[ERROR] $msg" -ForegroundColor Red; exit 1 }
function Clean($val) {
    if ($null -eq $val) { return "" }
    $s = ([string]$val).Trim()
    if ($s -eq "None") { return "" }
    return $s
}
function Write-JsonFile($path, $content) {
    $parent = Split-Path $path
    if ($parent -and -not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    [System.IO.File]::WriteAllText($path, $content, (New-Object System.Text.UTF8Encoding($false)))
}

# ------ 0. IDENTITY & ACCOUNT AUTO-DETECTION ---------------------------------------------------------------------------------------------------------------------
Log "Checking active AWS CLI credentials..."
try {
    $callerIdentityJson = aws sts get-caller-identity --output json 2>$null
    if (-not $callerIdentityJson) {
        throw "Could not retrieve AWS caller identity."
    }
    $callerIdentity = $callerIdentityJson | ConvertFrom-Json
    $AWS_ACCOUNT = $callerIdentity.Account.Trim()
    Ok "Authenticated to AWS Account: $AWS_ACCOUNT (Arn: $($callerIdentity.Arn))"
} catch {
    Err "AWS CLI is not logged in or token is expired.`nPlease run 'aws configure' (or 'aws login') with credentials for your new AWS account first."
}

# ------ CONFIGURATION & SECRETS (Loaded securely from .env.deploy) ---------------------------------------------
$deployEnvPath = Join-Path $PSScriptRoot ".env.deploy"
if (-not (Test-Path $deployEnvPath)) {
    Err "Missing configuration file '.env.deploy'!`nTo keep your secrets safe in a public repository, copy '.env.deploy.template' to '.env.deploy' and enter your Supabase & GitHub keys.`n('.env.deploy' is git-ignored and will never be committed to GitHub)."
}

$cfg = @{}
Get-Content $deployEnvPath | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
        $parts = $line.Split("=", 2)
        $cfg[$parts[0].Trim()] = $parts[1].Trim()
    }
}

$SUPABASE_URL         = $cfg["SUPABASE_URL"]
$SUPABASE_SERVICE_KEY = $cfg["SUPABASE_SERVICE_ROLE_KEY"]
$SUPABASE_ANON_KEY    = $cfg["SUPABASE_ANON_KEY"]
$DATABASE_URL         = $cfg["DATABASE_URL"]
$DIRECT_DATABASE_URL  = $cfg["DIRECT_DATABASE_URL"]

$GITHUB_CLIENT_ID     = $cfg["GITHUB_CLIENT_ID"]
$GITHUB_CLIENT_SECRET = $cfg["GITHUB_CLIENT_SECRET"]
$GITHUB_WEBHOOK_SECRET= $cfg["GITHUB_WEBHOOK_SECRET"]

$DOMAIN               = if ($cfg["DOMAIN"]) { $cfg["DOMAIN"] } else { "4istudios.in" }
$APP_DOMAIN           = if ($cfg["APP_DOMAIN"]) { $cfg["APP_DOMAIN"] } else { "servhub.$DOMAIN" }
$API_DOMAIN           = if ($cfg["API_DOMAIN"]) { $cfg["API_DOMAIN"] } else { "api-servhub.$DOMAIN" }

foreach ($req in @("SUPABASE_URL", "SUPABASE_SERVICE_KEY", "SUPABASE_ANON_KEY", "DATABASE_URL", "DIRECT_DATABASE_URL", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "GITHUB_WEBHOOK_SECRET")) {
    $val = (Get-Variable -Name $req -ValueOnly -ErrorAction SilentlyContinue)
    if (-not $val -or $val -match "\[YOUR_") {
        Err "Please provide a valid '$req' in '.env.deploy'."
    }
}

$AWS_REGION      = "ap-south-1"
$KEY_NAME        = "servhub-key"
$KEY_PATH        = "$HOME\Downloads\$KEY_NAME.pem"
$SG_NAME         = "servhub-sg"
$INSTANCE_NAME   = "servhub-prod"
$INSTANCE_TYPE   = "t4g.medium"
$AMI_ID          = "ami-060a59f869a11dca4"     # Ubuntu 24.04 LTS ARM64 ap-south-1

$EIP_NAME        = "servhub-eip"
$IAM_ROLE_NAME   = "servhub-ec2-role"
$IAM_PROFILE_NAME= "servhub-ec2-profile"

$ECR_API         = "servhub-api"
$ECR_BUILDER     = "servhub-builder"
$ECR_BASE        = "$AWS_ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com"

$S3_BUCKET       = "servhub-mini-deployments-$AWS_ACCOUNT"
$SQS_QUEUE_NAME  = "servhub-mini-builds"
$SQS_DLQ_NAME    = "servhub-mini-builds-dlq"

$CW_LOG_API      = "/servhub/api"
$CW_LOG_BUILDER  = "/ecs/servhub-mini-builder"

$ECS_CLUSTER     = "servhub-mini-cluster"
$ECS_SERVICE     = "servhub-mini-builder-service"
$ECS_TASK_FAMILY = "servhub-mini-builder"
$ECS_TASK_ROLE   = "servhub-mini-builder-task-role"
$ECS_EXEC_ROLE   = "ecsTaskExecutionRole"

################################################################################
# PHASE 1 --- AWS INFRASTRUCTURE (Provisioned once, skipped with -Resume)
################################################################################
if (-not $Resume) {

    # ------ 1a. IAM Role & Instance Profile for EC2 ---------------------------------------------------------------------------------------------
    Log "Configuring EC2 IAM Instance Profile (Zero static keys): $IAM_PROFILE_NAME"
    $trustPath = Join-Path $PSScriptRoot "infra/ec2-trust-policy.json"
    $trustDoc = '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
    Write-JsonFile $trustPath $trustDoc

    $roleCheck = Clean (aws iam list-roles --query "Roles[?RoleName=='$IAM_ROLE_NAME'].RoleName" --output text)
    if (-not $roleCheck -or $roleCheck -eq "None") {
        aws iam create-role --role-name $IAM_ROLE_NAME --assume-role-policy-document "file://$trustPath" | Out-Null
        Ok "Created IAM Role: $IAM_ROLE_NAME"
    } else {
        Ok "IAM Role already exists: $IAM_ROLE_NAME"
    }

    $policyDoc = @{
        Version = "2012-10-17"
        Statement = @(
            @{
                Sid = "SQSAccess"
                Effect = "Allow"
                Action = @("sqs:SendMessage","sqs:ReceiveMessage","sqs:DeleteMessage","sqs:ChangeMessageVisibility","sqs:GetQueueAttributes")
                Resource = "arn:aws:sqs:${AWS_REGION}:${AWS_ACCOUNT}:*"
            },
            @{
                Sid = "S3Access"
                Effect = "Allow"
                Action = @("s3:PutObject","s3:GetObject","s3:DeleteObject","s3:ListBucket")
                Resource = @("arn:aws:s3:::$S3_BUCKET","arn:aws:s3:::$S3_BUCKET/*")
            },
            @{
                Sid = "ECRAccess"
                Effect = "Allow"
                Action = @(
                    "ecr:GetAuthorizationToken",
                    "ecr:BatchCheckLayerAvailability",
                    "ecr:GetDownloadUrlForLayer",
                    "ecr:BatchGetImage",
                    "ecr:PutImage",
                    "ecr:InitiateLayerUpload",
                    "ecr:UploadLayerPart",
                    "ecr:CompleteLayerUpload"
                )
                Resource = "*"
            },
            @{
                Sid = "CloudWatchLogs"
                Effect = "Allow"
                Action = @("logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents","logs:DescribeLogStreams")
                Resource = "*"
            }
        )
    } | ConvertTo-Json -Depth 10

    $policyPath = Join-Path $PSScriptRoot "infra/ec2-role-policy.json"
    Write-JsonFile $policyPath $policyDoc
    aws iam put-role-policy --role-name $IAM_ROLE_NAME --policy-name "servhub-ec2-policy" --policy-document "file://$policyPath" | Out-Null
    Ok "IAM policy attached/updated on role"

    $existingProfile = Clean (aws iam list-instance-profiles --query "InstanceProfiles[?InstanceProfileName=='$IAM_PROFILE_NAME'].InstanceProfileName" --output text)
    if (-not $existingProfile -or $existingProfile -eq "None") {
        aws iam create-instance-profile --instance-profile-name $IAM_PROFILE_NAME | Out-Null
        aws iam add-role-to-instance-profile --instance-profile-name $IAM_PROFILE_NAME --role-name $IAM_ROLE_NAME | Out-Null
        Ok "Created and attached IAM profile: $IAM_PROFILE_NAME"
        Start-Sleep -Seconds 5
    } else {
        try {
            aws iam add-role-to-instance-profile --instance-profile-name $IAM_PROFILE_NAME --role-name $IAM_ROLE_NAME 2>$null | Out-Null
        } catch {}
        Ok "IAM Profile already exists: $IAM_PROFILE_NAME"
    }

    # ------ 1b. S3 Bucket ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
    Log "Checking S3 Bucket: $S3_BUCKET"
    $foundBucket = Clean (aws s3api list-buckets --query "Buckets[?Name=='$S3_BUCKET'].Name" --output text)
    if (-not $foundBucket -or $foundBucket -eq "None") {
        if ($AWS_REGION -eq "us-east-1") {
            aws s3api create-bucket --bucket $S3_BUCKET --region $AWS_REGION | Out-Null
        } else {
            aws s3api create-bucket --bucket $S3_BUCKET --region $AWS_REGION --create-bucket-configuration LocationConstraint=$AWS_REGION | Out-Null
        }
        aws s3api put-bucket-versioning --bucket $S3_BUCKET --versioning-configuration Status=Enabled --region $AWS_REGION | Out-Null
        aws s3api put-public-access-block --bucket $S3_BUCKET --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true --region $AWS_REGION | Out-Null
        Ok "Created S3 Bucket: $S3_BUCKET"
    } else {
        Ok "S3 Bucket already exists: $S3_BUCKET"
    }

    # ------ 1c. SQS Queues (Main + DLQ) ---------------------------------------------------------------------------------------------------------------------------------
    Log "Checking SQS DLQ: $SQS_DLQ_NAME"
    $dlqUrl = Clean (aws sqs list-queues --queue-name-prefix $SQS_DLQ_NAME --region $AWS_REGION --query "QueueUrls[?ends_with(@, '/$SQS_DLQ_NAME')]" --output text)
    if (-not $dlqUrl -or $dlqUrl -eq "None") {
        $dlqUrl = Clean (aws sqs create-queue --queue-name $SQS_DLQ_NAME --region $AWS_REGION --query "QueueUrl" --output text)
        Ok "Created DLQ: $dlqUrl"
    } else {
        Ok "DLQ already exists: $dlqUrl"
    }
    $dlqArn = Clean (aws sqs get-queue-attributes --queue-url $dlqUrl --attribute-names QueueArn --region $AWS_REGION --query "Attributes.QueueArn" --output text)

    Log "Checking SQS Main Queue: $SQS_QUEUE_NAME"
    $mainQueueUrl = Clean (aws sqs list-queues --queue-name-prefix $SQS_QUEUE_NAME --region $AWS_REGION --query "QueueUrls[?ends_with(@, '/$SQS_QUEUE_NAME')]" --output text)
    $redrivePolicy = (@{ deadLetterTargetArn = $dlqArn; maxReceiveCount = '3' } | ConvertTo-Json -Compress)
    $queueAttrs = @{
        VisibilityTimeout = "600"
        ReceiveMessageWaitTimeSeconds = "20"
        MessageRetentionPeriod = "86400"
        RedrivePolicy = $redrivePolicy
    }
    $sqsAttrPath = Join-Path $PSScriptRoot "infra/sqs-main-attributes.json"
    Write-JsonFile $sqsAttrPath ($queueAttrs | ConvertTo-Json -Compress)

    if (-not $mainQueueUrl -or $mainQueueUrl -eq "None") {
        $mainQueueUrl = Clean (aws sqs create-queue --queue-name $SQS_QUEUE_NAME --attributes "file://$sqsAttrPath" --region $AWS_REGION --query "QueueUrl" --output text)
        Ok "Created Main Queue: $mainQueueUrl"
    } else {
        aws sqs set-queue-attributes --queue-url $mainQueueUrl --attributes "file://$sqsAttrPath" --region $AWS_REGION | Out-Null
        Ok "Main Queue updated: $mainQueueUrl"
    }

    # ------ 1d. CloudWatch Log Groups ---------------------------------------------------------------------------------------------------------------------------------------
    Log "Checking CloudWatch Log Groups"
    foreach ($lg in @($CW_LOG_API, $CW_LOG_BUILDER)) {
        $lgExists = aws logs describe-log-groups --log-group-name-prefix $lg --region $AWS_REGION --query "logGroups[?logGroupName=='$lg'].logGroupName" --output text 2>$null
        if (-not $lgExists -or $lgExists -eq "None") {
            aws logs create-log-group --log-group-name $lg --region $AWS_REGION 2>$null | Out-Null
            aws logs put-retention-policy --log-group-name $lg --retention-in-days 14 --region $AWS_REGION 2>$null | Out-Null
            Ok "Created log group: $lg (14d retention)"
        } else {
            Ok "Log group already exists: $lg"
        }
    }

    # ------ 1d2. ECS Cluster & IAM Roles for Fargate Spot ---------------------------------------------------------------------------
    Log "Checking ECS Cluster: $ECS_CLUSTER"
    $clusterCheck = Clean (aws ecs describe-clusters --clusters $ECS_CLUSTER --region $AWS_REGION --query "clusters[?status=='ACTIVE'].clusterName" --output text 2>$null)
    if (-not $clusterCheck -or $clusterCheck -eq "None") {
        aws ecs create-cluster --cluster-name $ECS_CLUSTER --capacity-providers FARGATE FARGATE_SPOT --region $AWS_REGION | Out-Null
        Ok "Created ECS Cluster: $ECS_CLUSTER"
    } else {
        aws ecs put-cluster-capacity-providers --cluster $ECS_CLUSTER --capacity-providers FARGATE FARGATE_SPOT --default-capacity-provider-strategy capacityProvider=FARGATE_SPOT,weight=1 --region $AWS_REGION 2>$null | Out-Null
        Ok "ECS Cluster already exists: $ECS_CLUSTER"
    }

    Log "Checking ECS Execution Role: $ECS_EXEC_ROLE"
    $execRoleCheck = Clean (aws iam list-roles --query "Roles[?RoleName=='$ECS_EXEC_ROLE'].RoleName" --output text 2>$null)
    if (-not $execRoleCheck -or $execRoleCheck -eq "None") {
        $ecsTrustDoc = '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
        $ecsTrustPath = Join-Path $PSScriptRoot "infra/task-trust-policy.json"
        Write-JsonFile $ecsTrustPath $ecsTrustDoc
        aws iam create-role --role-name $ECS_EXEC_ROLE --assume-role-policy-document "file://$ecsTrustPath" | Out-Null
        aws iam attach-role-policy --role-name $ECS_EXEC_ROLE --policy-arn "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy" | Out-Null
        Ok "Created ECS Execution Role: $ECS_EXEC_ROLE"
    } else {
        Ok "ECS Execution Role already exists: $ECS_EXEC_ROLE"
    }

    Log "Checking ECS Task Role: $ECS_TASK_ROLE"
    $taskRoleCheck = Clean (aws iam list-roles --query "Roles[?RoleName=='$ECS_TASK_ROLE'].RoleName" --output text 2>$null)
    if (-not $taskRoleCheck -or $taskRoleCheck -eq "None") {
        $taskTrustPath = Join-Path $PSScriptRoot "infra/task-trust-policy.json"
        aws iam create-role --role-name $ECS_TASK_ROLE --assume-role-policy-document "file://$taskTrustPath" | Out-Null
        $taskPolicyDoc = @{
            Version = "2012-10-17"
            Statement = @(
                @{
                    Effect = "Allow"
                    Action = @("sqs:ReceiveMessage","sqs:DeleteMessage","sqs:ChangeMessageVisibility","sqs:GetQueueAttributes")
                    Resource = "arn:aws:sqs:${AWS_REGION}:${AWS_ACCOUNT}:*"
                },
                @{
                    Effect = "Allow"
                    Action = @("s3:PutObject","s3:GetObject","s3:DeleteObject","s3:ListBucket")
                    Resource = @("arn:aws:s3:::$S3_BUCKET","arn:aws:s3:::$S3_BUCKET/*")
                }
            )
        } | ConvertTo-Json -Depth 10
        $taskPolPath = Join-Path $PSScriptRoot "infra/builder-task-policy.json"
        Write-JsonFile $taskPolPath $taskPolicyDoc
        aws iam put-role-policy --role-name $ECS_TASK_ROLE --policy-name "BuilderTaskPolicy" --policy-document "file://$taskPolPath" | Out-Null
        Ok "Created ECS Task Role: $ECS_TASK_ROLE"
    } else {
        Ok "ECS Task Role already exists: $ECS_TASK_ROLE"
    }

    # ------ 1e. Key Pair ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
    Log "Checking EC2 key pair: $KEY_NAME"
    $existingKey = Clean (aws ec2 describe-key-pairs --query "KeyPairs[?KeyName=='$KEY_NAME'].KeyName" --region $AWS_REGION --output text)
    if ($existingKey -and (Test-Path $KEY_PATH)) {
        Ok "Key pair already exists at: $KEY_PATH"
    } else {
        if (Test-Path $KEY_PATH) {
            icacls $KEY_PATH /grant:r "${env:USERNAME}:F" 2>$null | Out-Null
            Remove-Item -Force $KEY_PATH -ErrorAction SilentlyContinue
        }
        aws ec2 delete-key-pair --key-name $KEY_NAME --region $AWS_REGION 2>$null | Out-Null
        $keyMatLines = aws ec2 create-key-pair `
            --key-name $KEY_NAME `
            --query "KeyMaterial" `
            --output text `
            --region $AWS_REGION
        $keyMat = ($keyMatLines -join "`n") + "`n"
        [System.IO.File]::WriteAllText($KEY_PATH, $keyMat, [System.Text.Encoding]::ASCII)
        icacls $KEY_PATH /inheritance:r /grant:r "${env:USERNAME}:R" | Out-Null
        Ok "Created and saved key to $KEY_PATH"
    }

    # ------ 1f. Security Group ------------------------------------------------------------------------------------------------------------------------------------------------------------
    Log "Checking security group: $SG_NAME"
    $existingSG = Clean (aws ec2 describe-security-groups `
        --filters "Name=group-name,Values=$SG_NAME" `
        --query "SecurityGroups[0].GroupId" `
        --output text `
        --region $AWS_REGION 2>$null)

    if ($existingSG) {
        $SG_ID = $existingSG
        Ok "Security group already exists: $SG_ID"
    } else {
        $SG_ID = Clean (aws ec2 create-security-group `
            --group-name $SG_NAME `
            --description "ServHub production security group" `
            --query "GroupId" `
            --output text `
            --region $AWS_REGION)
        Ok "Created security group: $SG_ID"

        # Allow SSH (Port 22), HTTP (Port 80), HTTPS (Port 443)
        aws ec2 authorize-security-group-ingress --group-id $SG_ID --protocol tcp --port 22 --cidr "0.0.0.0/0" --region $AWS_REGION | Out-Null
        aws ec2 authorize-security-group-ingress --group-id $SG_ID --protocol tcp --port 80 --cidr "0.0.0.0/0" --region $AWS_REGION | Out-Null
        aws ec2 authorize-security-group-ingress --group-id $SG_ID --protocol tcp --port 443 --cidr "0.0.0.0/0" --region $AWS_REGION | Out-Null
        Ok "Inbound rules configured (SSH, HTTP, HTTPS)"
    }

    # ------ 1g. Launch EC2 Instance ---------------------------------------------------------------------------------------------------------------------------------------------
    Log "Checking for existing EC2 instance: $INSTANCE_NAME"
    $INSTANCE_ID = Clean (aws ec2 describe-instances `
        --filters "Name=tag:Name,Values=$INSTANCE_NAME" "Name=instance-state-name,Values=running,pending,stopped" `
        --query "Reservations[0].Instances[0].InstanceId" `
        --output text `
        --region $AWS_REGION 2>$null)

    if ($INSTANCE_ID) {
        $instData = aws ec2 describe-instances --instance-ids $INSTANCE_ID --query "Reservations[0].Instances[0]" --output json --region $AWS_REGION 2>$null | ConvertFrom-Json
        $instState = Clean $instData.State.Name
        $curType   = Clean $instData.InstanceType
        $curAmi    = Clean $instData.ImageId

        if ($curType -ne $INSTANCE_TYPE -or $curAmi -ne $AMI_ID) {
            Warn "Existing instance $INSTANCE_ID is $curType ($curAmi), but target is $INSTANCE_TYPE ($AMI_ID). Replacing instance..."
            aws ec2 terminate-instances --instance-ids $INSTANCE_ID --region $AWS_REGION | Out-Null
            Log "Waiting for previous instance to terminate..."
            aws ec2 wait instance-terminated --instance-ids $INSTANCE_ID --region $AWS_REGION 2>$null
            $INSTANCE_ID = $null
        } else {
            if ($instState -eq "stopped") {
                Log "Instance is stopped. Starting instance: $INSTANCE_ID..."
                aws ec2 start-instances --instance-ids $INSTANCE_ID --region $AWS_REGION | Out-Null
            }
            Ok "Instance already exists: $INSTANCE_ID (State: $instState)"
        }
    }

    if (-not $INSTANCE_ID) {
        Log "Launching EC2 instance ($INSTANCE_TYPE, ARM64 Ubuntu 26.04)..."
        $blockMappingPath = Join-Path $PSScriptRoot "infra/ec2-block-mappings.json"
        Write-JsonFile $blockMappingPath '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":20,"VolumeType":"gp3"}}]'

        $INSTANCE_ID = Clean (aws ec2 run-instances `
            --image-id $AMI_ID `
            --instance-type $INSTANCE_TYPE `
            --key-name $KEY_NAME `
            --security-group-ids $SG_ID `
            --iam-instance-profile "Name=$IAM_PROFILE_NAME" `
            --metadata-options "HttpEndpoint=enabled,HttpPutResponseHopLimit=2,HttpTokens=optional" `
            --block-device-mappings "file://$blockMappingPath" `
            --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$INSTANCE_NAME}]" `
            --query "Instances[0].InstanceId" `
            --output text `
            --region $AWS_REGION)

        if (-not $INSTANCE_ID -or $INSTANCE_ID -eq "None") {
            Err "Failed to launch EC2 instance. Check AWS CLI output."
        }
        Ok "Launched instance: $INSTANCE_ID"
    }

    Log "Waiting for instance to be in 'running' state..."
    aws ec2 wait instance-running --instance-ids $INSTANCE_ID --region $AWS_REGION

    # Ensure IAM role and IMDS hop limit are attached
    aws ec2 modify-instance-metadata-options --instance-id $INSTANCE_ID --http-put-response-hop-limit 2 --http-endpoint enabled --region $AWS_REGION 2>$null | Out-Null

    $profileAssoc = aws ec2 describe-iam-instance-profile-associations `
        --filters "Name=instance-id,Values=$INSTANCE_ID" "Name=state,Values=associated,associating" `
        --query "IamInstanceProfileAssociations[0].AssociationId" `
        --region $AWS_REGION --output text 2>$null
    if (-not $profileAssoc -or $profileAssoc -eq "None") {
        try {
            aws ec2 associate-iam-instance-profile `
                --instance-id $INSTANCE_ID `
                --iam-instance-profile "Name=$IAM_PROFILE_NAME" `
                --region $AWS_REGION 2>$null | Out-Null
        } catch {}
    }

    # ------ 1h. Elastic IP (Permanent Public IP) ------------------------------------------------------------------------------------------------------
    Log "Checking Elastic IP: $EIP_NAME"
    $existingEip = aws ec2 describe-addresses `
        --filters "Name=tag:Name,Values=$EIP_NAME" `
        --query "Addresses[0]" `
        --region $AWS_REGION --output json 2>$null | ConvertFrom-Json

    if ($existingEip -and $existingEip.AllocationId) {
        $ALLOCATION_ID = $existingEip.AllocationId
        $EC2_IP        = $existingEip.PublicIp
        Ok "Reusing existing Elastic IP: $EC2_IP ($ALLOCATION_ID)"
    } else {
        Log "Allocating new Elastic IP..."
        $eipRes = aws ec2 allocate-address `
            --domain vpc `
            --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$EIP_NAME}]" `
            --region $AWS_REGION --output json | ConvertFrom-Json
        $ALLOCATION_ID = $eipRes.AllocationId
        $EC2_IP        = $eipRes.PublicIp
        Ok "Allocated Elastic IP: $EC2_IP ($ALLOCATION_ID)"
    }

    Log "Associating Elastic IP ($EC2_IP) with instance $INSTANCE_ID..."
    aws ec2 associate-address `
        --instance-id $INSTANCE_ID `
        --allocation-id $ALLOCATION_ID `
        --allow-reassociation `
        --region $AWS_REGION | Out-Null
    Ok "Permanent Elastic IP active: $EC2_IP"

    # ------ 1i. ECR Repositories ------------------------------------------------------------------------------------------------------------------------------------------------------
    Log "Checking ECR repositories"
    foreach ($repo in @($ECR_API, $ECR_BUILDER)) {
        $exists = Clean (aws ecr describe-repositories --query "repositories[?repositoryName=='$repo'].repositoryName" --region $AWS_REGION --output text 2>$null)
        if ($exists -and $exists -ne "None") {
            Ok "$repo already exists"
        } else {
            aws ecr create-repository --repository-name $repo --region $AWS_REGION | Out-Null
            Ok "Created: $repo"
        }
    }

} else {
    # Resume mode --- look up existing Elastic IP & SQS Queue URL
    Log "Resume mode: looking up Elastic IP and SQS Queue"
    $existingEip = aws ec2 describe-addresses `
        --filters "Name=tag:Name,Values=$EIP_NAME" `
        --query "Addresses[0].PublicIp" `
        --region $AWS_REGION --output text 2>$null
    if (-not $existingEip -or $existingEip -eq "None") { Err "Could not find Elastic IP tagged '$EIP_NAME'" }
    $EC2_IP = Clean $existingEip
    Ok "Found Elastic IP: $EC2_IP"

    $mainQueueUrl = Clean (aws sqs get-queue-url --queue-name $SQS_QUEUE_NAME --region $AWS_REGION --query "QueueUrl" --output text)
    $existingSG = Clean (aws ec2 describe-security-groups --filters "Name=group-name,Values=$SG_NAME" --query "SecurityGroups[0].GroupId" --output text --region $AWS_REGION 2>$null)
    if ($existingSG -and $existingSG -ne "None") { $SG_ID = $existingSG }
}

################################################################################
# PHASE 2 --- SERVER PROVISIONING VIA SSH
################################################################################

function Remote($cmd) {
    $normalized = (($cmd -replace "\r\n", "`n") -replace "\r", "`n").Trim() + "`n"
    $tempSh = [System.IO.Path]::GetTempFileName()
    [System.IO.File]::WriteAllBytes($tempSh, [System.Text.Encoding]::UTF8.GetBytes($normalized))
    scp -i $KEY_PATH -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o BatchMode=yes $tempSh "ubuntu@${EC2_IP}:/tmp/remote_script.sh" | Out-Null
    ssh -i $KEY_PATH -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o BatchMode=yes -n "ubuntu@$EC2_IP" "bash -e /tmp/remote_script.sh"
    $exitCode = $LASTEXITCODE
    ssh -i $KEY_PATH -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o BatchMode=yes -n "ubuntu@$EC2_IP" "rm -f /tmp/remote_script.sh" 2>$null | Out-Null
    Remove-Item -Force $tempSh -ErrorAction SilentlyContinue
    if ($exitCode -ne 0) { Err "Remote command execution failed on EC2 (exit code: $exitCode)." }
}

function Upload($local, $remote) {
    scp -i $KEY_PATH -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o BatchMode=yes -r $local "ubuntu@${EC2_IP}:${remote}"
}

Log "Verifying SSH connection to $EC2_IP..."
$sshSuccess = $false
for ($i = 1; $i -le 30; $i++) {
    try {
        $sshTest = ssh -i $KEY_PATH -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o BatchMode=yes -o ConnectTimeout=5 "ubuntu@$EC2_IP" "echo ready" 2>$null
        if ($sshTest -match "ready") {
            $sshSuccess = $true
            break
        }
    } catch {}
    Write-Host "    Waiting for SSH ($i/30)..." -ForegroundColor DarkGray
    Start-Sleep -Seconds 10
}
if (-not $sshSuccess) { Err "SSH connection to ubuntu@$EC2_IP timed out. Check security group rules." }
Ok "SSH connected successfully"

# ------ 2a. Install Docker, Nginx, AWS CLI on EC2 ---------------------------------------------------------------------------------------------------
Log "Ensuring Docker, Nginx, and AWS CLI are installed on EC2"
Remote @"
sudo apt-get update -q
sudo apt-get install -y -q nginx unzip curl
if ! command -v aws &> /dev/null; then
    ARCH=`$(uname -m)
    curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-`$ARCH.zip" -o "/tmp/awscliv2.zip"
    unzip -q /tmp/awscliv2.zip -d /tmp
    sudo /tmp/aws/install
    rm -rf /tmp/aws /tmp/awscliv2.zip
fi
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker ubuntu
fi
sudo systemctl enable --now nginx
sudo systemctl enable --now docker
"@
Ok "Packages installed and active"

################################################################################
# PHASE 3 --- BUILD & RUN CONTAINER SERVICES DIRECTLY ON EC2
################################################################################

Log "Packaging API and Builder source code for EC2 build"
$apiTar = Join-Path $env:TEMP "servhub-api.tar.gz"
$builderTar = Join-Path $env:TEMP "servhub-builder.tar.gz"
tar --exclude="node_modules" --exclude="dist" -czf $apiTar -C (Join-Path $PSScriptRoot "apps\api") .
tar --exclude="node_modules" --exclude="dist" -czf $builderTar -C (Join-Path $PSScriptRoot "apps\builder") .

Log "Uploading application sources to EC2..."
scp -i $KEY_PATH -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o BatchMode=yes $apiTar "ubuntu@${EC2_IP}:/tmp/api.tar.gz"
scp -i $KEY_PATH -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o BatchMode=yes $builderTar "ubuntu@${EC2_IP}:/tmp/builder.tar.gz"
Remove-Item -Force $apiTar, $builderTar -ErrorAction SilentlyContinue

Log "Building Docker containers on EC2 and pushing to ECR..."
Remote @"
sudo rm -rf /tmp/build-api /tmp/build-builder
mkdir -p /tmp/build-api /tmp/build-builder
tar -xzf /tmp/api.tar.gz -C /tmp/build-api
tar -xzf /tmp/builder.tar.gz -C /tmp/build-builder
sudo docker build -t ${ECR_API}:latest -t $ECR_BASE/${ECR_API}:latest /tmp/build-api
sudo docker build -t ${ECR_BUILDER}:latest -t $ECR_BASE/${ECR_BUILDER}:latest /tmp/build-builder
sudo sh -c "aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_BASE"
sudo docker push $ECR_BASE/${ECR_API}:latest
sudo docker push $ECR_BASE/${ECR_BUILDER}:latest
sudo rm -rf /tmp/build-api /tmp/build-builder /tmp/api.tar.gz /tmp/builder.tar.gz
"@
Ok "Docker containers built and pushed to ECR successfully"

# ------ 3a. Write Runtime Environment File (NO STATIC AWS KEYS NEEDED!) ---------------------------------
Log "Writing runtime environment file on EC2 (/etc/servhub.env)"
$envContent = @"
DATABASE_URL=$DATABASE_URL
DIRECT_DATABASE_URL=$DIRECT_DATABASE_URL
SUPABASE_URL=$SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_KEY
AWS_REGION=$AWS_REGION
SQS_QUEUE_URL=$mainQueueUrl
S3_BUCKET_NAME=$S3_BUCKET
GITHUB_CLIENT_ID=$GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET=$GITHUB_CLIENT_SECRET
GITHUB_WEBHOOK_SECRET=$GITHUB_WEBHOOK_SECRET
API_BASE_URL=https://$API_DOMAIN
PLATFORM_DOMAIN=$DOMAIN
PORT=3001
HOST=0.0.0.0
NODE_ENV=production
"@
$envContent | ssh -i $KEY_PATH -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o BatchMode=yes "ubuntu@$EC2_IP" "sudo tee /etc/servhub.env > /dev/null && sudo chmod 600 /etc/servhub.env"
Ok "Environment file written securely"
# ------ 3b. Run API Container on EC2 with CloudWatch Logging ------------------------------------------------------------------
Log "Starting Fastify API container with CloudWatch logging on EC2"
Remote @"
sudo docker stop servhub-api servhub-builder 2>/dev/null || true
sudo docker rm   servhub-api servhub-builder 2>/dev/null || true
sudo docker run -d \
  --name servhub-api \
  --restart always \
  --env-file /etc/servhub.env \
  -p 3001:3001 \
  --log-driver awslogs \
  --log-opt awslogs-region=$AWS_REGION \
  --log-opt awslogs-group=$CW_LOG_API \
  --log-opt awslogs-stream=servhub-api \
  --log-opt awslogs-create-group=true \
  $ECR_BASE/${ECR_API}:latest
"@
Ok "Fastify API running on EC2 with automatic CloudWatch logging via EC2 IAM role"

# ------ 3c. Deploy Builder Task to ECS Fargate Spot ------------------------------------------------------------------------------------------------
Log "Deploying ServHub Builder to ECS Fargate Spot (Zero-Cost Optimization)..."

Log "Registering ECS Task Definition: $ECS_TASK_FAMILY (Fargate ARM64)"
$taskDefDoc = @{
    family = $ECS_TASK_FAMILY
    networkMode = "awsvpc"
    requiresCompatibilities = @("FARGATE")
    cpu = "1024"
    memory = "2048"
    executionRoleArn = "arn:aws:iam::${AWS_ACCOUNT}:role/${ECS_EXEC_ROLE}"
    taskRoleArn = "arn:aws:iam::${AWS_ACCOUNT}:role/${ECS_TASK_ROLE}"
    runtimePlatform = @{
        cpuArchitecture = "ARM64"
        operatingSystemFamily = "LINUX"
    }
    containerDefinitions = @(
        @{
            name = "servhub-builder"
            image = "$ECR_BASE/${ECR_BUILDER}:latest"
            essential = $true
            environment = @(
                @{ name = "AWS_REGION"; value = $AWS_REGION },
                @{ name = "SQS_QUEUE_URL"; value = $mainQueueUrl },
                @{ name = "S3_BUCKET_NAME"; value = $S3_BUCKET },
                @{ name = "PLATFORM_DOMAIN"; value = $DOMAIN },
                @{ name = "SUPABASE_URL"; value = $SUPABASE_URL },
                @{ name = "SUPABASE_SERVICE_ROLE_KEY"; value = $SUPABASE_SERVICE_KEY }
            )
            logConfiguration = @{
                logDriver = "awslogs"
                options = @{
                    "awslogs-group"         = $CW_LOG_BUILDER
                    "awslogs-region"        = $AWS_REGION
                    "awslogs-stream-prefix" = "ecs"
                }
            }
        }
    )
} | ConvertTo-Json -Depth 10

$taskDefFile = Join-Path $PSScriptRoot "infra/fargate-task-def.json"
Write-JsonFile $taskDefFile $taskDefDoc

$regTaskDef = aws ecs register-task-definition --cli-input-json "file://$taskDefFile" --region $AWS_REGION 2>$null | ConvertFrom-Json
if (-not $regTaskDef -or -not $regTaskDef.taskDefinition.taskDefinitionArn) {
    Err "Failed to register ECS Task Definition."
}
$taskDefArn = $regTaskDef.taskDefinition.taskDefinitionArn
Ok "Registered Task Definition: $taskDefArn"

# Get default VPC subnets
$subnets = (aws ec2 describe-subnets --filters "Name=default-for-az,Values=true" --region $AWS_REGION --query "Subnets[*].SubnetId" --output text) -split "`t| " | Where-Object { $_.Trim() }

$netConfigFile = Join-Path $PSScriptRoot "infra/ecs-network-config.json"
Write-JsonFile $netConfigFile (@{
    awsvpcConfiguration = @{
        subnets = @($subnets)
        securityGroups = @($SG_ID)
        assignPublicIp = "ENABLED"
    }
} | ConvertTo-Json)

Log "Deploying ECS Fargate Spot Service: $ECS_SERVICE..."
$svcCheck = Clean (aws ecs describe-services --cluster $ECS_CLUSTER --services $ECS_SERVICE --region $AWS_REGION --query "services[?status=='ACTIVE'].serviceName" --output text 2>$null)

if (-not $svcCheck -or $svcCheck -eq "None") {
    aws ecs create-service `
        --cluster $ECS_CLUSTER `
        --service-name $ECS_SERVICE `
        --task-definition $ECS_TASK_FAMILY `
        --desired-count 1 `
        --capacity-provider-strategy "capacityProvider=FARGATE_SPOT,weight=1" `
        --network-configuration "file://$netConfigFile" `
        --region $AWS_REGION | Out-Null
    Ok "Created ECS Fargate Spot Service: $ECS_SERVICE"
} else {
    aws ecs update-service `
        --cluster $ECS_CLUSTER `
        --service $ECS_SERVICE `
        --task-definition $ECS_TASK_FAMILY `
        --force-new-deployment `
        --network-configuration "file://$netConfigFile" `
        --region $AWS_REGION | Out-Null
    Ok "Updated ECS Fargate Spot Service: $ECS_SERVICE with latest task definition"
}

################################################################################
# PHASE 4 --- BUILD & DEPLOY DASHBOARD FRONTEND
################################################################################

Log "Building dashboard frontend"
Push-Location apps\dashboard
if (-not (Test-Path "node_modules")) {
    Log "Installing dashboard npm dependencies..."
    npm install
    if ($LASTEXITCODE -ne 0) { Err "npm install failed for dashboard" }
}
$env:VITE_API_BASE_URL      = "https://$API_DOMAIN"
$env:VITE_SUPABASE_URL      = $SUPABASE_URL
$env:VITE_SUPABASE_ANON_KEY = $SUPABASE_ANON_KEY
npm run build
if ($LASTEXITCODE -ne 0) { Err "Dashboard build failed" }
Ok "Dashboard built -> dist/"
Pop-Location

Log "Uploading Dashboard static files"
Remote "sudo mkdir -p /var/www/dashboard && sudo chmod 777 /var/www/dashboard"
$tarPath = Join-Path $PSScriptRoot "apps\dashboard\dist.tar.gz"
tar -czf $tarPath -C (Join-Path $PSScriptRoot "apps\dashboard\dist") .
scp -i $KEY_PATH -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o BatchMode=yes $tarPath "ubuntu@${EC2_IP}:/tmp/dist.tar.gz"
Remove-Item -Force $tarPath -ErrorAction SilentlyContinue
Remote "sudo tar -xzf /tmp/dist.tar.gz -C /var/www/dashboard && sudo rm -f /tmp/dist.tar.gz && sudo chown -R www-data:www-data /var/www/dashboard"
Ok "Dashboard files uploaded"

# ------ 4e. Nginx Reverse Proxy Configuration with SSL ---------------------------------------------------------------------------------------
Log "Configuring Nginx reverse proxy with SSL"
Remote @"
sudo mkdir -p /etc/nginx/ssl
if [ ! -f /etc/nginx/ssl/servhub.crt ]; then
    sudo openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
      -keyout /etc/nginx/ssl/servhub.key \
      -out /etc/nginx/ssl/servhub.crt \
      -subj '/C=US/ST=State/L=City/O=ServHub/CN=*.$DOMAIN'
    sudo chmod 600 /etc/nginx/ssl/servhub.key
fi
"@

$nginxConf = @"
server {
    listen 80;
    listen 443 ssl;
    server_name $APP_DOMAIN;

    ssl_certificate /etc/nginx/ssl/servhub.crt;
    ssl_certificate_key /etc/nginx/ssl/servhub.key;
    ssl_protocols TLSv1.2 TLSv1.3;

    root /var/www/dashboard;
    index index.html;

    location / {
        try_files `$uri `$uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}

server {
    listen 80;
    listen 443 ssl;
    server_name $API_DOMAIN;

    ssl_certificate /etc/nginx/ssl/servhub.crt;
    ssl_certificate_key /etc/nginx/ssl/servhub.key;
    ssl_protocols TLSv1.2 TLSv1.3;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host              `$host;
        proxy_set_header X-Real-IP         `$remote_addr;
        proxy_set_header X-Forwarded-For   `$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto `$scheme;
        proxy_set_header Upgrade           `$http_upgrade;
        proxy_set_header Connection        "upgrade";
        proxy_read_timeout 120s;
        proxy_connect_timeout 10s;
    }
}

server {
    listen 80;
    listen 443 ssl;
    server_name ~^(?<subdomain>[a-zA-Z0-9_-]+)\.$DOMAIN$;

    ssl_certificate /etc/nginx/ssl/servhub.crt;
    ssl_certificate_key /etc/nginx/ssl/servhub.key;
    ssl_protocols TLSv1.2 TLSv1.3;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host              `$host;
        proxy_set_header X-Real-IP         `$remote_addr;
        proxy_set_header X-Forwarded-For   `$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto `$scheme;
        proxy_set_header Upgrade           `$http_upgrade;
        proxy_set_header Connection        "upgrade";
        proxy_read_timeout 120s;
        proxy_connect_timeout 10s;
    }
}
"@
$nginxConf | ssh -i $KEY_PATH -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o BatchMode=yes "ubuntu@$EC2_IP" "sudo tee /etc/nginx/sites-available/servhub > /dev/null"
Remote @"
sudo ln -sf /etc/nginx/sites-available/servhub /etc/nginx/sites-enabled/servhub
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
"@
Ok "Nginx successfully configured with SSL and reloaded"

################################################################################
# COMPLETE SUMMARY
################################################################################

Write-Host ""
Write-Host "==================================================================" -ForegroundColor Green
Write-Host "               SERVED & DEPLOYED SUCCESSFULLY!                    " -ForegroundColor Green
Write-Host "==================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  PERMANENT ELASTIC IP : " -NoNewline -ForegroundColor White
Write-Host "$EC2_IP" -ForegroundColor Yellow
Write-Host "  AWS Account ID       : $AWS_ACCOUNT" -ForegroundColor Gray
Write-Host "  S3 Deployments Bucket: $S3_BUCKET" -ForegroundColor Gray
Write-Host "  SQS Builds Queue     : $mainQueueUrl" -ForegroundColor Gray
Write-Host ""
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "               CLOUDFLARE DNS CONFIGURATION (1-TIME)             " -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "  In your Cloudflare DNS dashboard for domain '$DOMAIN':" -ForegroundColor White
Write-Host ""
Write-Host "    Type   Name          IPv4 Address   Proxy status" -ForegroundColor Gray
Write-Host "    A      servhub       $EC2_IP        Proxied (Orange Cloud)" -ForegroundColor Yellow
Write-Host "    A      api-servhub   $EC2_IP        Proxied (Orange Cloud)" -ForegroundColor Yellow
Write-Host ""
Write-Host "  *Note: Because this is an Elastic IP, you will NEVER need to" -ForegroundColor DarkGray
Write-Host "   change these Cloudflare records again, even on redeployments!" -ForegroundColor DarkGray
Write-Host ""
Write-Host "==================================================================" -ForegroundColor Green
Write-Host "  App URL : https://$APP_DOMAIN" -ForegroundColor Green
Write-Host "  API URL : https://$API_DOMAIN" -ForegroundColor Green
Write-Host "==================================================================" -ForegroundColor Green
Write-Host ""

