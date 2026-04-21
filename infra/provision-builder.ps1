param(
  [bool]$SkipEcr = $true
)

$ErrorActionPreference='Stop'
$PSNativeCommandUseErrorActionPreference=$true
$env:AWS_PAGER=''

$region='ap-south-1'
$account='421454275395'
$queue='servhub-mini-builds'
$dlq='servhub-mini-builds-dlq'
$bucket='servhub-mini-deployments-421454275395'
$ecrRepo='servhub-mini-builder'
$cluster='servhub-mini-cluster'
$service='servhub-mini-builder-service'
$taskRole='servhub-mini-builder-task-role'
$execRole='ecsTaskExecutionRole'
$logGroup='/ecs/servhub-mini-builder'
$platformDomain='yourplatform.dev'
$subnets=@('subnet-02b25e48c33b63045','subnet-0ddde69c866e57771','subnet-03a95dddadbdadbe1')
$securityGroup='sg-0a6b765ef9cee0ce5'

$failures = New-Object System.Collections.Generic.List[object]
$state = [ordered]@{}

function Invoke-Step {
  param([string]$Name,[string]$Command,[scriptblock]$Action)
  try { & $Action } catch {
    $failures.Add([pscustomobject]@{Step=$Name;Command=$Command;Error=$_.Exception.Message}) | Out-Null
    Write-Output "STEP_FAILED: $Name"
  }
}

Invoke-Step '1. SQS queues and attributes' 'aws sqs create-queue/get-queue-attributes/set-queue-attributes' {
  $state.dlqUrl=(aws sqs create-queue --queue-name $dlq --region $region --query 'QueueUrl' --output text).Trim()
  $state.mainQueueUrl=(aws sqs create-queue --queue-name $queue --region $region --query 'QueueUrl' --output text).Trim()
  $state.dlqArn=(aws sqs get-queue-attributes --queue-url $state.dlqUrl --attribute-names QueueArn --region $region --query 'Attributes.QueueArn' --output text).Trim()
  $attrs=@{VisibilityTimeout='600';MessageRetentionPeriod='86400';ReceiveMessageWaitTimeSeconds='20';RedrivePolicy=(@{deadLetterTargetArn=$state.dlqArn;maxReceiveCount='3'}|ConvertTo-Json -Compress)}
  $attrPath=Join-Path $PWD 'infra/sqs-main-attributes.json'
  New-Item -ItemType Directory -Force -Path (Split-Path $attrPath) | Out-Null
  $attrs|ConvertTo-Json -Compress|Set-Content -Encoding utf8 $attrPath
  aws sqs set-queue-attributes --queue-url $state.mainQueueUrl --region $region --attributes ("file://"+$attrPath) | Out-Null
  $state.mainQueueArn=(aws sqs get-queue-attributes --queue-url $state.mainQueueUrl --attribute-names QueueArn --region $region --query 'Attributes.QueueArn' --output text).Trim()
}

Invoke-Step '2. S3 bucket setup' 'aws s3api head/create/versioning/public-block' {
  $exists=$true; try { aws s3api head-bucket --bucket $bucket 2>$null | Out-Null } catch { $exists=$false }
  if(-not $exists){ aws s3api create-bucket --bucket $bucket --region $region --create-bucket-configuration LocationConstraint=$region | Out-Null }
  aws s3api put-bucket-versioning --bucket $bucket --versioning-configuration Status=Enabled --region $region | Out-Null
  aws s3api put-public-access-block --bucket $bucket --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true --region $region | Out-Null
}

Invoke-Step '3. ECR repository' 'aws ecr describe/create/put-image-scanning-configuration' {
  if ($SkipEcr) {
    $state.ecrRepoUri = "$account.dkr.ecr.$region.amazonaws.com/$ecrRepo"
    Write-Output 'STEP_INFO: ECR step skipped (SkipEcr=true)'
    return
  }

  $repoUri = $null
  try {
    $repoUri = (aws ecr describe-repositories --repository-names $ecrRepo --region $region --query 'repositories[0].repositoryUri' --output text 2>$null).Trim()
    if ($repoUri -eq 'None') { $repoUri = $null }
  } catch {}

  if (-not $repoUri) {
    aws ecr create-repository --repository-name $ecrRepo --image-scanning-configuration scanOnPush=true --region $region | Out-Null
    $repoUri = (aws ecr describe-repositories --repository-names $ecrRepo --region $region --query 'repositories[0].repositoryUri' --output text).Trim()
  }

  aws ecr put-image-scanning-configuration --repository-name $ecrRepo --image-scanning-configuration scanOnPush=true --region $region | Out-Null
  $state.ecrRepoUri = $repoUri
}

Invoke-Step '4. ECS cluster' 'aws ecs describe-clusters/create-cluster' {
  $d=aws ecs describe-clusters --clusters $cluster --region $region --output json|ConvertFrom-Json
  if(-not $d.clusters -or $d.clusters.Count -eq 0 -or $d.clusters[0].status -eq 'INACTIVE'){
    $c=aws ecs create-cluster --cluster-name $cluster --region $region --output json|ConvertFrom-Json
    $state.clusterArn=$c.cluster.clusterArn
  } else { $state.clusterArn=$d.clusters[0].clusterArn }
}

Invoke-Step '5. Log group' 'aws logs describe/create/put-retention-policy' {
  $lg=aws logs describe-log-groups --log-group-name-prefix $logGroup --region $region --query "logGroups[?logGroupName=='$logGroup'].logGroupName" --output text
  if(-not $lg){ aws logs create-log-group --log-group-name $logGroup --region $region | Out-Null }
  aws logs put-retention-policy --log-group-name $logGroup --retention-in-days 14 --region $region | Out-Null
}

Invoke-Step '6. Task IAM role and inline policy' 'aws iam get/create/update role + put-role-policy' {
  $trust='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
  $trustPath=Join-Path $PWD 'infra/task-trust-policy.json'
  Set-Content -Encoding utf8 $trustPath $trust
  $r=$null; try { $r=aws iam get-role --role-name $taskRole --output json|ConvertFrom-Json } catch {}
  if(-not $r){ $r=aws iam create-role --role-name $taskRole --assume-role-policy-document ("file://"+$trustPath) --output json|ConvertFrom-Json }
  else { aws iam update-assume-role-policy --role-name $taskRole --policy-document ("file://"+$trustPath) | Out-Null }
  $state.taskRoleArn=if($r){$r.Role.Arn}else{(aws iam get-role --role-name $taskRole --query 'Role.Arn' --output text).Trim()}
  $pol=@{Version='2012-10-17';Statement=@(
    @{Effect='Allow';Action=@('sqs:ReceiveMessage','sqs:DeleteMessage','sqs:ChangeMessageVisibility','sqs:GetQueueAttributes');Resource=$state.mainQueueArn},
    @{Effect='Allow';Action=@('s3:PutObject','s3:GetObject','s3:DeleteObject');Resource="arn:aws:s3:::$bucket/*"},
    @{Effect='Allow';Action=@('s3:ListBucket');Resource="arn:aws:s3:::$bucket"}
  )}|ConvertTo-Json -Depth 8
  $polPath=Join-Path $PWD 'infra/task-inline-policy.json'
  Set-Content -Encoding utf8 $polPath $pol
  aws iam put-role-policy --role-name $taskRole --policy-name 'servhub-mini-builder-inline' --policy-document ("file://"+$polPath) | Out-Null
}

Invoke-Step '7. Execution IAM role' 'aws iam get/create/update + attach managed policy + inline ssm access' {
  $trust='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
  $trustPath=Join-Path $PWD 'infra/exec-trust-policy.json'
  Set-Content -Encoding utf8 $trustPath $trust
  $r=$null; try { $r=aws iam get-role --role-name $execRole --output json|ConvertFrom-Json } catch {}
  if(-not $r){ $r=aws iam create-role --role-name $execRole --assume-role-policy-document ("file://"+$trustPath) --output json|ConvertFrom-Json }
  else { aws iam update-assume-role-policy --role-name $execRole --policy-document ("file://"+$trustPath) | Out-Null }
  aws iam attach-role-policy --role-name $execRole --policy-arn 'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy' | Out-Null

  $execInline = @{
    Version = '2012-10-17'
    Statement = @(
      @{
        Sid = 'AllowBuilderSsmParameters'
        Effect = 'Allow'
        Action = @('ssm:GetParameter','ssm:GetParameters')
        Resource = "arn:aws:ssm:${region}:${account}:parameter/servhub-mini/builder/*"
      },
      @{
        Sid = 'AllowKmsDecryptForSsm'
        Effect = 'Allow'
        Action = @('kms:Decrypt')
        Resource = '*'
        Condition = @{
          StringEquals = @{
            'kms:ViaService' = "ssm.$region.amazonaws.com"
          }
        }
      }
    )
  } | ConvertTo-Json -Depth 12

  $execInlinePath = Join-Path $PWD 'infra/exec-inline-policy.json'
  Set-Content -Encoding utf8 $execInlinePath $execInline
  aws iam put-role-policy --role-name $execRole --policy-name 'servhub-mini-exec-ssm-inline' --policy-document ("file://"+$execInlinePath) | Out-Null

  $state.execRoleArn=if($r){$r.Role.Arn}else{(aws iam get-role --role-name $execRole --query 'Role.Arn' --output text).Trim()}
}

Invoke-Step '8. SSM parameters' 'aws ssm put-parameter/get-parameter' {
  aws ssm put-parameter --name '/servhub-mini/builder/SUPABASE_URL' --type String --value 'https://xkldqliccvgrfnckrlyw.supabase.co' --overwrite --region $region | Out-Null
  aws ssm put-parameter --name '/servhub-mini/builder/SUPABASE_SERVICE_ROLE_KEY' --type SecureString --value 'replace_with_service_role_key' --overwrite --region $region | Out-Null
  $state.supabaseUrlArn=(aws ssm get-parameter --name '/servhub-mini/builder/SUPABASE_URL' --region $region --query 'Parameter.ARN' --output text).Trim()
  $state.supabaseKeyArn=(aws ssm get-parameter --name '/servhub-mini/builder/SUPABASE_SERVICE_ROLE_KEY' --with-decryption --region $region --query 'Parameter.ARN' --output text).Trim()
}

Invoke-Step '9. Render task definition JSON' 'write infra/ecs-task-definition.builder.rendered.json' {
  $td=[ordered]@{
    family='servhub-mini-builder';networkMode='awsvpc';requiresCompatibilities=@('FARGATE');cpu='512';memory='1024';
    executionRoleArn=$state.execRoleArn;taskRoleArn=$state.taskRoleArn;
    containerDefinitions=@([ordered]@{
      name='servhub-mini-builder';image=($state.ecrRepoUri+':latest');essential=$true;
      environment=@(
        @{name='AWS_REGION';value=$region},
        @{name='SQS_QUEUE_URL';value=$state.mainQueueUrl},
        @{name='S3_BUCKET_NAME';value=$bucket},
        @{name='PLATFORM_DOMAIN';value=$platformDomain},
        @{name='SQS_VISIBILITY_TIMEOUT_SECONDS';value='600'},
        @{name='SQS_WAIT_TIME_SECONDS';value='20'}
      );
      secrets=@(@{name='SUPABASE_URL';valueFrom=$state.supabaseUrlArn},@{name='SUPABASE_SERVICE_ROLE_KEY';valueFrom=$state.supabaseKeyArn});
      logConfiguration=@{logDriver='awslogs';options=@{'awslogs-group'=$logGroup;'awslogs-region'=$region;'awslogs-stream-prefix'='ecs'}}
    })
  }
  New-Item -ItemType Directory -Force -Path (Join-Path $PWD 'infra') | Out-Null
  $state.taskDefPath=Join-Path $PWD 'infra/ecs-task-definition.builder.rendered.json'
  $td|ConvertTo-Json -Depth 25|Set-Content -Encoding utf8 $state.taskDefPath
}

Invoke-Step '10. Register task definition' 'aws ecs register-task-definition' {
  $reg=aws ecs register-task-definition --cli-input-json ("file://"+$state.taskDefPath) --region $region --output json|ConvertFrom-Json
  $state.taskDefinitionArn=$reg.taskDefinition.taskDefinitionArn
}

Invoke-Step '11. Create/update ECS service' 'aws ecs describe-services/create-service/update-service' {
  $desiredCount = if ($SkipEcr) { 0 } else { 1 }
  $sd=aws ecs describe-services --cluster $cluster --services $service --region $region --output json|ConvertFrom-Json
  $missing=$false
  if($sd.failures -and $sd.failures[0].reason -eq 'MISSING'){$missing=$true}
  if($missing -or -not $sd.services -or $sd.services.Count -eq 0){
    $req=[ordered]@{cluster=$cluster;serviceName=$service;taskDefinition=$state.taskDefinitionArn;desiredCount=$desiredCount;capacityProviderStrategy=@(@{capacityProvider='FARGATE_SPOT';weight=1},@{capacityProvider='FARGATE';weight=0;base=1});networkConfiguration=@{awsvpcConfiguration=@{subnets=$subnets;securityGroups=@($securityGroup);assignPublicIp='ENABLED'}}}
    $reqPath=Join-Path $PWD 'infra/ecs-service-create.json'
    $req|ConvertTo-Json -Depth 12|Set-Content -Encoding utf8 $reqPath
    aws ecs create-service --cli-input-json ("file://"+$reqPath) --region $region | Out-Null
  } else {
    aws ecs update-service --cluster $cluster --service $service --task-definition $state.taskDefinitionArn --desired-count $desiredCount --region $region | Out-Null
  }
  $svc=aws ecs describe-services --cluster $cluster --services $service --region $region --query 'services[0].{arn:serviceArn,status:status}' --output json|ConvertFrom-Json
  $state.serviceArn=$svc.arn
  $state.serviceStatus=$svc.status
}

Invoke-Step '12. CloudWatch DLQ alarm' 'aws cloudwatch put-metric-alarm' {
  $state.alarmName='servhub-mini-builds-dlq-visible'
  aws cloudwatch put-metric-alarm --alarm-name $state.alarmName --alarm-description 'DLQ has visible messages' --namespace 'AWS/SQS' --metric-name 'ApproximateNumberOfMessagesVisible' --dimensions Name=QueueName,Value=$dlq --statistic Average --period 300 --evaluation-periods 1 --threshold 1 --comparison-operator GreaterThanOrEqualToThreshold --treat-missing-data notBreaching --region $region | Out-Null
}

try { if(-not $state.clusterArn){$state.clusterArn=(aws ecs describe-clusters --clusters $cluster --region $region --query 'clusters[0].clusterArn' --output text).Trim()} } catch {}
try { if(-not $state.serviceArn){$state.serviceArn=(aws ecs describe-services --cluster $cluster --services $service --region $region --query 'services[0].serviceArn' --output text).Trim();$state.serviceStatus=(aws ecs describe-services --cluster $cluster --services $service --region $region --query 'services[0].status' --output text).Trim()} } catch {}
try { if(-not $state.taskRoleArn){$state.taskRoleArn=(aws iam get-role --role-name $taskRole --query 'Role.Arn' --output text).Trim()} } catch {}
try { if(-not $state.execRoleArn){$state.execRoleArn=(aws iam get-role --role-name $execRole --query 'Role.Arn' --output text).Trim()} } catch {}
try { if(-not $state.ecrRepoUri){$state.ecrRepoUri=(aws ecr describe-repositories --repository-names $ecrRepo --region $region --query 'repositories[0].repositoryUri' --output text).Trim()} } catch {}
try { if(-not $state.mainQueueArn -and $state.mainQueueUrl){$state.mainQueueArn=(aws sqs get-queue-attributes --queue-url $state.mainQueueUrl --attribute-names QueueArn --region $region --query 'Attributes.QueueArn' --output text).Trim()} } catch {}
try { if(-not $state.dlqArn -and $state.dlqUrl){$state.dlqArn=(aws sqs get-queue-attributes --queue-url $state.dlqUrl --attribute-names QueueArn --region $region --query 'Attributes.QueueArn' --output text).Trim()} } catch {}

'---SUMMARY---'
"MAIN_QUEUE_URL={0}" -f $state.mainQueueUrl
"MAIN_QUEUE_ARN={0}" -f $state.mainQueueArn
"DLQ_URL={0}" -f $state.dlqUrl
"DLQ_ARN={0}" -f $state.dlqArn
"BUCKET={0}" -f $bucket
"ECR_REPO_URI={0}" -f $state.ecrRepoUri
"CLUSTER_ARN={0}" -f $state.clusterArn
"SERVICE_ARN={0}" -f $state.serviceArn
"SERVICE_STATUS={0}" -f $state.serviceStatus
"TASK_DEFINITION_ARN={0}" -f $state.taskDefinitionArn
"TASK_ROLE_ARN={0}" -f $state.taskRoleArn
"EXEC_ROLE_ARN={0}" -f $state.execRoleArn
"ALARM_NAME={0}" -f $state.alarmName
"ECR_SKIPPED={0}" -f $SkipEcr
if($failures.Count -gt 0){
  '---FAILURES---'
  $failures | ForEach-Object { "STEP={0} | COMMAND={1} | ERROR={2}" -f $_.Step,$_.Command,$_.Error }
} else {
  '---FAILURES---NONE'
}
