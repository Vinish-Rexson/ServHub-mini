$ErrorActionPreference = 'Continue'
$env:AWS_PAGER = ''
$region = 'ap-south-1'

Write-Host "Step 0: Context set (ErrorActionPreference=Continue, AWS_PAGER empty, region=$region)"

# 1) ECS service and cluster
$clusterName = 'vercel-clone-cluster'
$serviceName = 'vercel-clone-builder-service'
$clusterExists = $false
$clusterCheck = aws ecs describe-clusters --region $region --clusters $clusterName --query "length(clusters[?status!=\`'INACTIVE\`'])" --output text 2>$null
if ($LASTEXITCODE -eq 0 -and $clusterCheck -match '^\d+$' -and [int]$clusterCheck -gt 0) { $clusterExists = $true }

if ($clusterExists) {
  $svcCount = aws ecs describe-services --region $region --cluster $clusterName --services $serviceName --query "length(services[?status!=\`'INACTIVE\`'])" --output text 2>$null
  if ($LASTEXITCODE -eq 0 -and $svcCount -match '^\d+$' -and [int]$svcCount -gt 0) {
    aws ecs update-service --region $region --cluster $clusterName --service $serviceName --desired-count 0 1>$null 2>$null
    aws ecs delete-service --region $region --cluster $clusterName --service $serviceName --force 1>$null 2>$null
    Write-Host "Step 1: ECS service $serviceName -> desired 0 set and delete forced"
  } else {
    Write-Host "Step 1: ECS service $serviceName -> not found (skip)"
  }
} else {
  Write-Host "Step 1: ECS cluster $clusterName -> not found (service delete skipped)"
}

# 2) ECS task definitions family prefix vercel-clone-builder (ACTIVE)
$taskArnsRaw = aws ecs list-task-definitions --region $region --family-prefix vercel-clone-builder --status ACTIVE --query "taskDefinitionArns" --output text 2>$null
$taskArns = @()
if ($LASTEXITCODE -eq 0 -and $taskArnsRaw -and $taskArnsRaw -ne 'None') { $taskArns = $taskArnsRaw -split "\s+" | Where-Object { $_ } }
if ($taskArns.Count -gt 0) {
  foreach ($td in $taskArns) { aws ecs deregister-task-definition --region $region --task-definition $td 1>$null 2>$null }
  Write-Host "Step 2: ECS task definitions deregistered -> $($taskArns.Count)"
} else {
  Write-Host "Step 2: ECS task definitions -> none found"
}

# 3) ECS cluster delete
if ($clusterExists) {
  aws ecs delete-cluster --region $region --cluster $clusterName 1>$null 2>$null
  Write-Host "Step 3: ECS cluster $clusterName delete attempted"
} else {
  Write-Host "Step 3: ECS cluster $clusterName already absent"
}

# 4) ECR repo force delete
$repoName = 'vercel-clone-builder'
$repoExists = $false
aws ecr describe-repositories --region $region --repository-names $repoName 1>$null 2>$null
if ($LASTEXITCODE -eq 0) { $repoExists = $true }
if ($repoExists) {
  aws ecr delete-repository --region $region --repository-name $repoName --force 1>$null 2>$null
  Write-Host "Step 4: ECR repo $repoName force delete attempted"
} else {
  Write-Host "Step 4: ECR repo $repoName not found"
}

# 5) SQS queues
$queues = @('vercel-clone-builds','vercel-clone-builds-dlq')
foreach ($q in $queues) {
  $qUrl = aws sqs get-queue-url --region $region --queue-name $q --query "QueueUrl" --output text 2>$null
  if ($LASTEXITCODE -eq 0 -and $qUrl -and $qUrl -ne 'None') {
    aws sqs delete-queue --region $region --queue-url $qUrl 1>$null 2>$null
    Write-Host "Step 5: SQS queue $q delete attempted"
  } else {
    Write-Host "Step 5: SQS queue $q not found"
  }
}

# 6) S3 bucket objects + delete
$bucket = 'vercel-clone-deployments-421454275395'
aws s3api head-bucket --bucket $bucket 1>$null 2>$null
if ($LASTEXITCODE -eq 0) {
  aws s3 rm "s3://$bucket" --recursive --region $region 1>$null 2>$null
  aws s3api delete-bucket --bucket $bucket --region $region 1>$null 2>$null
  Write-Host "Step 6: S3 bucket $bucket objects removed and bucket delete attempted"
} else {
  Write-Host "Step 6: S3 bucket $bucket not found/inaccessible"
}

# 7) CloudWatch log group
$lg = '/ecs/vercel-clone-builder'
$lgCount = aws logs describe-log-groups --region $region --log-group-name-prefix $lg --query "length(logGroups[?logGroupName==\`'$lg\`'])" --output text 2>$null
if ($LASTEXITCODE -eq 0 -and $lgCount -match '^\d+$' -and [int]$lgCount -gt 0) {
  aws logs delete-log-group --region $region --log-group-name $lg 1>$null 2>$null
  Write-Host "Step 7: Log group $lg delete attempted"
} else {
  Write-Host "Step 7: Log group $lg not found"
}

# 8) CloudWatch alarm
$alarm = 'vercel-clone-builds-dlq-visible'
$alarmCount = aws cloudwatch describe-alarms --region $region --alarm-names $alarm --query "length(MetricAlarms)" --output text 2>$null
if ($LASTEXITCODE -eq 0 -and $alarmCount -match '^\d+$' -and [int]$alarmCount -gt 0) {
  aws cloudwatch delete-alarms --region $region --alarm-names $alarm 1>$null 2>$null
  Write-Host "Step 8: Alarm $alarm delete attempted"
} else {
  Write-Host "Step 8: Alarm $alarm not found"
}

# 9) SSM parameters under /vercel-clone/
$paramRaw = aws ssm get-parameters-by-path --region $region --path /vercel-clone --recursive --query "Parameters[].Name" --output text 2>$null
$params = @()
if ($LASTEXITCODE -eq 0 -and $paramRaw -and $paramRaw -ne 'None') { $params = $paramRaw -split "\s+" | Where-Object { $_ } }
if ($params.Count -gt 0) {
  for ($i=0; $i -lt $params.Count; $i+=10) {
    $chunk = $params[$i..([Math]::Min($i+9,$params.Count-1))]
    aws ssm delete-parameters --region $region --names $chunk 1>$null 2>$null
  }
  Write-Host "Step 9: SSM parameters deleted -> $($params.Count)"
} else {
  Write-Host "Step 9: SSM parameters under /vercel-clone/ -> none found"
}

# 10) IAM role cleanup + delete
$role = 'vercel-clone-builder-task-role'
aws iam get-role --role-name $role 1>$null 2>$null
if ($LASTEXITCODE -eq 0) {
  $inlineRaw = aws iam list-role-policies --role-name $role --query "PolicyNames" --output text 2>$null
  $inline = @()
  if ($LASTEXITCODE -eq 0 -and $inlineRaw -and $inlineRaw -ne 'None') { $inline = $inlineRaw -split "\s+" | Where-Object { $_ } }
  foreach ($p in $inline) { aws iam delete-role-policy --role-name $role --policy-name $p 1>$null 2>$null }

  $attachedRaw = aws iam list-attached-role-policies --role-name $role --query "AttachedPolicies[].PolicyArn" --output text 2>$null
  $attached = @()
  if ($LASTEXITCODE -eq 0 -and $attachedRaw -and $attachedRaw -ne 'None') { $attached = $attachedRaw -split "\s+" | Where-Object { $_ } }
  foreach ($a in $attached) { aws iam detach-role-policy --role-name $role --policy-arn $a 1>$null 2>$null }

  aws iam delete-role --role-name $role 1>$null 2>$null
  Write-Host "Step 10: IAM role $role cleanup and delete attempted (inline=$($inline.Count), attached=$($attached.Count))"
} else {
  Write-Host "Step 10: IAM role $role not found"
}

# Verification 1) remaining vercel-clone resources
$remEcsClusters = aws ecs list-clusters --region $region --query "clusterArns[?contains(@, 'vercel-clone')]" --output json 2>$null
$remEcsTaskDefs = aws ecs list-task-definitions --region $region --family-prefix vercel-clone-builder --query "taskDefinitionArns" --output json 2>$null
$remEcr = aws ecr describe-repositories --region $region --query "repositories[?contains(repositoryName, 'vercel-clone')].repositoryName" --output json 2>$null
$remSqs = aws sqs list-queues --region $region --queue-name-prefix vercel-clone --query "QueueUrls" --output json 2>$null
$remS3 = aws s3api list-buckets --query "Buckets[?contains(Name, 'vercel-clone')].Name" --output json 2>$null
$remLogs = aws logs describe-log-groups --region $region --log-group-name-prefix /ecs/vercel-clone --query "logGroups[].logGroupName" --output json 2>$null
$remAlarms = aws cloudwatch describe-alarms --region $region --alarm-name-prefix vercel-clone --query "MetricAlarms[].AlarmName" --output json 2>$null
$remSsm = aws ssm get-parameters-by-path --region $region --path /vercel-clone --recursive --query "Parameters[].Name" --output json 2>$null
$remIam = aws iam list-roles --query "Roles[?contains(RoleName, 'vercel-clone')].RoleName" --output json 2>$null

Write-Host "Verification 1: Remaining ECS clusters -> $remEcsClusters"
Write-Host "Verification 1: Remaining ECS task defs -> $remEcsTaskDefs"
Write-Host "Verification 1: Remaining ECR repos -> $remEcr"
Write-Host "Verification 1: Remaining SQS queues -> $remSqs"
Write-Host "Verification 1: Remaining S3 buckets -> $remS3"
Write-Host "Verification 1: Remaining CW log groups -> $remLogs"
Write-Host "Verification 1: Remaining CW alarms -> $remAlarms"
Write-Host "Verification 1: Remaining SSM params -> $remSsm"
Write-Host "Verification 1: Remaining IAM roles -> $remIam"

# Verification 2) servhub-mini status
$servhub = aws ecs describe-services --region ap-south-1 --cluster servhub-mini-cluster --services servhub-mini-builder-service --query "services[0].{status:status,desired:desiredCount,running:runningCount,pending:pendingCount,taskDef:taskDefinition}" --output json 2>$null
Write-Host "Verification 2: servhub-mini status -> $servhub"
