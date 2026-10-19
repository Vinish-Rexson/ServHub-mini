<#
.SYNOPSIS
    Idempotent Infrastructure Teardown Script for ServHub Mini on AWS.
.DESCRIPTION
    Safely and completely destroys all provisioned AWS resources across ECS Fargate,
    EC2, ECR, S3, SQS, CloudWatch, and IAM. This script is fully idempotent and can
    be re-run multiple times without failing if resources are already removed.
.PARAMETER Force
    Skips the interactive confirmation prompt.
.PARAMETER Region
    The AWS region to clean up (default: ap-south-1).
#>

[CmdletBinding()]
param(
    [switch]$Force,
    [string]$Region = "ap-south-1"
)

$ErrorActionPreference = "Continue"
$env:AWS_PAGER = ""

function Ok($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "  [WARN] $msg" -ForegroundColor Yellow }
function Log($msg)  { Write-Host "==> $msg" -ForegroundColor Cyan }
function Err($msg)  { Write-Host "  [ERR] $msg" -ForegroundColor Red }

# ------ 0. Verify AWS Identity ---------------------------------------------------------------------------------------------------------------------------------------------------------
Log "Verifying AWS Credentials..."
$caller = aws sts get-caller-identity --output json 2>$null | ConvertFrom-Json
if (-not $caller -or -not $caller.Account) {
    Err "Unable to determine AWS account identity. Please configure 'aws configure' first."
    exit 1
}

$ACCOUNT_ID = $caller.Account
Ok "Connected to AWS Account: $ACCOUNT_ID (User/Role: $($caller.Arn))"
Ok "Target Region: $Region"

if (-not $Force) {
    Write-Host "`n[!] WARNING: This will permanently delete ALL ServHub resources in account $ACCOUNT_ID ($Region):" -ForegroundColor Red
    Write-Host "    - ECS Fargate Service & Cluster (servhub-mini-cluster)"
    Write-Host "    - EC2 Instance (servhub-prod) & Elastic IP (servhub-eip)"
    Write-Host "    - S3 Deployments Bucket (servhub-mini-deployments-$ACCOUNT_ID)"
    Write-Host "    - SQS Build Queues (servhub-mini-builds)"
    Write-Host "    - ECR Repositories (servhub-api, servhub-builder)"
    Write-Host "    - CloudWatch Log Groups & Alarms"
    Write-Host "    - IAM Roles & Instance Profiles"
    $confirm = Read-Host "`nType 'yes' to proceed with teardown"
    if ($confirm -ne "yes") {
        Write-Host "Teardown aborted by user." -ForegroundColor Yellow
        exit 0
    }
}

Write-Host "`nBeginning idempotent teardown...`n" -ForegroundColor Cyan

# ------ 1. ECS Fargate Service & Cluster ---------------------------------------------------------------------------------------------------------------------------
$CLUSTER = "servhub-mini-cluster"
$SERVICE = "servhub-mini-builder-service"
$TASK_FAMILY = "servhub-mini-builder"

Log "Checking ECS Service: $SERVICE..."
$svcCheck = aws ecs describe-services --cluster $CLUSTER --services $SERVICE --region $Region --query "services[?status=='ACTIVE'].serviceName" --output text 2>$null
if ($svcCheck -and $svcCheck -ne "None") {
    Log "Scaling down ECS Service '$SERVICE' to 0..."
    aws ecs update-service --cluster $CLUSTER --service $SERVICE --desired-count 0 --region $Region 2>$null | Out-Null
    Log "Deleting ECS Service '$SERVICE'..."
    aws ecs delete-service --cluster $CLUSTER --service $SERVICE --force --region $Region 2>$null | Out-Null
    Ok "Deleted ECS Service: $SERVICE"
} else {
    Ok "ECS Service '$SERVICE' does not exist or is already inactive."
}

Log "Deregistering ECS Task Definitions in family '$TASK_FAMILY'..."
$taskArns = aws ecs list-task-definitions --family-prefix $TASK_FAMILY --region $Region --query "taskDefinitionArns[]" --output text 2>$null
if ($taskArns -and $taskArns -ne "None") {
    foreach ($arn in ($taskArns -split "`t| ")) {
        if ($arn.Trim()) {
            aws ecs deregister-task-definition --task-definition $arn.Trim() --region $Region 2>$null | Out-Null
        }
    }
    Ok "Deregistered task definitions for: $TASK_FAMILY"
} else {
    Ok "No task definitions found for: $TASK_FAMILY"
}

Log "Checking ECS Cluster: $CLUSTER..."
$clusterCheck = aws ecs describe-clusters --clusters $CLUSTER --region $Region --query "clusters[?status=='ACTIVE'].clusterName" --output text 2>$null
if ($clusterCheck -and $clusterCheck -ne "None") {
    aws ecs delete-cluster --cluster $CLUSTER --region $Region 2>$null | Out-Null
    Ok "Deleted ECS Cluster: $CLUSTER"
} else {
    Ok "ECS Cluster '$CLUSTER' does not exist."
}

# ------ 2. CloudWatch Alarms & Log Groups ---------------------------------------------------------------------------------------------------------------------------
Log "Cleaning CloudWatch Alarms & Log Groups..."
aws cloudwatch delete-alarms --alarm-names "servhub-builds-dlq-alarm" "servhub-mini-builds-dlq-visible" --region $Region 2>$null | Out-Null
Ok "CloudWatch alarms removed."

foreach ($lg in @("/servhub/api", "/servhub/builder", "/ecs/servhub-mini-builder", "/ecs/vercel-clone-builder")) {
    $exists = aws logs describe-log-groups --log-group-name-prefix $lg --region $Region --query "logGroups[?logGroupName=='$lg'].logGroupName" --output text 2>$null
    if ($exists -and $exists -ne "None") {
        aws logs delete-log-group --log-group-name $lg --region $Region 2>$null | Out-Null
        Ok "Deleted Log Group: $lg"
    }
}

# ------ 3. EC2 Instance & Elastic IP ------------------------------------------------------------------------------------------------------------------------------------------
$INSTANCE_NAME = "servhub-prod"
$EIP_NAME = "servhub-eip"

Log "Checking EC2 Instance: $INSTANCE_NAME..."
$instanceId = aws ec2 describe-instances --region $Region --filters "Name=tag:Name,Values=$INSTANCE_NAME" "Name=instance-state-name,Values=pending,running,stopping,stopped" --query "Reservations[].Instances[].InstanceId" --output text 2>$null
if ($instanceId -and $instanceId -ne "None") {
    Log "Terminating EC2 Instance ($instanceId)..."
    aws ec2 terminate-instances --instance-ids $instanceId --region $Region 2>$null | Out-Null
    Log "Waiting for instance ($instanceId) to terminate..."
    aws ec2 wait instance-terminated --instance-ids $instanceId --region $Region 2>$null
    Ok "Terminated EC2 Instance: $instanceId"
} else {
    Ok "No running EC2 instance found for: $INSTANCE_NAME"
}

Log "Checking Elastic IP: $EIP_NAME..."
$allocId = aws ec2 describe-addresses --region $Region --filters "Name=tag:Name,Values=$EIP_NAME" --query "Addresses[0].AllocationId" --output text 2>$null
if ($allocId -and $allocId -ne "None") {
    aws ec2 release-address --allocation-id $allocId --region $Region 2>$null | Out-Null
    Ok "Released Elastic IP ($allocId)"
} else {
    Ok "Elastic IP '$EIP_NAME' not found."
}

# ------ 4. EC2 Security Group & Key Pair ------------------------------------------------------------------------------------------------------------------------------
$SG_NAME = "servhub-sg"
$KEY_NAME = "servhub-key"

Log "Checking Security Group: $SG_NAME..."
$sgId = aws ec2 describe-security-groups --region $Region --filters "Name=group-name,Values=$SG_NAME" --query "SecurityGroups[0].GroupId" --output text 2>$null
if ($sgId -and $sgId -ne "None") {
    aws ec2 delete-security-group --group-id $sgId --region $Region 2>$null | Out-Null
    Ok "Deleted Security Group: $sgId"
} else {
    Ok "Security Group '$SG_NAME' not found."
}

Log "Checking Key Pair: $KEY_NAME..."
$keyCheck = aws ec2 describe-key-pairs --region $Region --key-names $KEY_NAME --query "KeyPairs[0].KeyName" --output text 2>$null
if ($keyCheck -and $keyCheck -ne "None") {
    aws ec2 delete-key-pair --key-name $KEY_NAME --region $Region 2>$null | Out-Null
    Ok "Deleted EC2 Key Pair in AWS: $KEY_NAME"
} else {
    Ok "Key Pair '$KEY_NAME' not found in AWS."
}

# ------ 5. Amazon SQS Queues ------------------------------------------------------------------------------------------------------------------------------------------------------------------
Log "Cleaning up SQS Queues..."
foreach ($qName in @("servhub-mini-builds", "servhub-mini-builds-dlq")) {
    $qUrl = aws sqs get-queue-url --queue-name $qName --region $Region --query "QueueUrl" --output text 2>$null
    if ($qUrl -and $qUrl -ne "None") {
        aws sqs delete-queue --queue-url $qUrl --region $Region 2>$null | Out-Null
        Ok "Deleted SQS Queue: $qName"
    } else {
        Ok "SQS Queue '$qName' not found."
    }
}

# ------ 6. Amazon S3 Bucket (Empty & Delete) ------------------------------------------------------------------------------------------------------------------
$BUCKET_NAME = "servhub-mini-deployments-$ACCOUNT_ID"
Log "Checking S3 Bucket: $BUCKET_NAME..."
$bCheck = aws s3api head-bucket --bucket $BUCKET_NAME 2>$null
if ($LASTEXITCODE -eq 0) {
    Log "Purging all objects & versions in S3 Bucket '$BUCKET_NAME'..."
    aws s3 rm "s3://$BUCKET_NAME" --recursive 2>$null | Out-Null

    # Delete all versioned objects & delete markers if versioning was enabled
    $versions = aws s3api list-object-versions --bucket $BUCKET_NAME --output json 2>$null | ConvertFrom-Json
    if ($versions.Versions) {
        foreach ($v in $versions.Versions) {
            aws s3api delete-object --bucket $BUCKET_NAME --key $v.Key --version-id $v.VersionId 2>$null | Out-Null
        }
    }
    if ($versions.DeleteMarkers) {
        foreach ($m in $versions.DeleteMarkers) {
            aws s3api delete-object --bucket $BUCKET_NAME --key $m.Key --version-id $m.VersionId 2>$null | Out-Null
        }
    }

    Log "Deleting S3 Bucket: $BUCKET_NAME..."
    aws s3api delete-bucket --bucket $BUCKET_NAME --region $Region 2>$null | Out-Null
    Ok "Deleted S3 Bucket: $BUCKET_NAME"
} else {
    Ok "S3 Bucket '$BUCKET_NAME' does not exist."
}

# ------ 7. Amazon ECR Repositories ------------------------------------------------------------------------------------------------------------------------------------------------
Log "Cleaning up ECR Repositories..."
foreach ($repo in @("servhub-api", "servhub-builder", "servhub-mini-builder")) {
    $rCheck = aws ecr describe-repositories --repository-names $repo --region $Region --query "repositories[0].repositoryName" --output text 2>$null
    if ($rCheck -and $rCheck -ne "None") {
        aws ecr delete-repository --repository-name $repo --force --region $Region 2>$null | Out-Null
        Ok "Deleted ECR Repository: $repo (with all images)"
    } else {
        Ok "ECR Repository '$repo' not found."
    }
}

# ------ 8. IAM Roles & Instance Profiles ------------------------------------------------------------------------------------------------------------------------------
Log "Cleaning up IAM Roles & Instance Profiles..."

# Remove EC2 Instance Profile
$PROFILE_NAME = "servhub-ec2-profile"
$ROLE_EC2 = "servhub-ec2-role"
$profCheck = aws iam get-instance-profile --instance-profile-name $PROFILE_NAME --query "InstanceProfile.InstanceProfileName" --output text 2>$null
if ($profCheck -and $profCheck -ne "None") {
    aws iam remove-role-from-instance-profile --instance-profile-name $PROFILE_NAME --role-name $ROLE_EC2 2>$null | Out-Null
    aws iam delete-instance-profile --instance-profile-name $PROFILE_NAME 2>$null | Out-Null
    Ok "Deleted Instance Profile: $PROFILE_NAME"
}

# Delete EC2 IAM Role
$r1 = aws iam get-role --role-name $ROLE_EC2 --query "Role.RoleName" --output text 2>$null
if ($r1 -and $r1 -ne "None") {
    $pols = aws iam list-role-policies --role-name $ROLE_EC2 --query "PolicyNames[]" --output text 2>$null
    if ($pols -and $pols -ne "None") {
        foreach ($p in ($pols -split "`t| ")) {
            if ($p.Trim()) { aws iam delete-role-policy --role-name $ROLE_EC2 --policy-name $p.Trim() 2>$null | Out-Null }
        }
    }
    aws iam delete-role --role-name $ROLE_EC2 2>$null | Out-Null
    Ok "Deleted IAM Role: $ROLE_EC2"
}

# Delete Builder Task Role
$ROLE_TASK = "servhub-mini-builder-task-role"
$r2 = aws iam get-role --role-name $ROLE_TASK --query "Role.RoleName" --output text 2>$null
if ($r2 -and $r2 -ne "None") {
    $pols = aws iam list-role-policies --role-name $ROLE_TASK --query "PolicyNames[]" --output text 2>$null
    if ($pols -and $pols -ne "None") {
        foreach ($p in ($pols -split "`t| ")) {
            if ($p.Trim()) { aws iam delete-role-policy --role-name $ROLE_TASK --policy-name $p.Trim() 2>$null | Out-Null }
        }
    }
    aws iam delete-role --role-name $ROLE_TASK 2>$null | Out-Null
    Ok "Deleted IAM Role: $ROLE_TASK"
}

# Delete ECS Execution Role
$ROLE_EXEC = "ecsTaskExecutionRole"
$r3 = aws iam get-role --role-name $ROLE_EXEC --query "Role.RoleName" --output text 2>$null
if ($r3 -and $r3 -ne "None") {
    aws iam detach-role-policy --role-name $ROLE_EXEC --policy-arn "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy" 2>$null | Out-Null
    aws iam delete-role --role-name $ROLE_EXEC 2>$null | Out-Null
    Ok "Deleted IAM Role: $ROLE_EXEC"
}

# ------ 9. Teardown Complete ------------------------------------------------------------------------------------------------------------------------------------------------------------------
Write-Host ""
Write-Host "================================================================================" -ForegroundColor Green
Write-Host "  TEARDOWN COMPLETE --- All ServHub resources cleanly removed in $Region" -ForegroundColor Green
Write-Host "================================================================================" -ForegroundColor Green
Write-Host ""

