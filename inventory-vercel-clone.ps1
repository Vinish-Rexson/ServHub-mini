$ErrorActionPreference = 'Stop'
$env:AWS_PAGER=''
$region='ap-south-1'
$needle='vercel-clone'

function Test-Match([string]$value){
  if ([string]::IsNullOrEmpty($value)) { return $false }
  return $value.ToLower().Contains($needle)
}

$clusterArns = @((aws ecs list-clusters --region $region --output json | ConvertFrom-Json).clusterArns)
$matchingClusters = @($clusterArns | Where-Object { Test-Match $_ })

$ecsServices = @()
foreach ($clusterArn in $clusterArns) {
  $serviceArns = @((aws ecs list-services --region $region --cluster $clusterArn --output json | ConvertFrom-Json).serviceArns)
  $matchedServiceArns = @($serviceArns | Where-Object { Test-Match $_ })
  if ($matchedServiceArns.Count -gt 0) {
    $ecsServices += [PSCustomObject]@{ clusterArn = $clusterArn; serviceArns = $matchedServiceArns }
  }
}

$taskDefArns = @((aws ecs list-task-definitions --region $region --status ACTIVE --output json | ConvertFrom-Json).taskDefinitionArns)
$matchingTaskDefs = @($taskDefArns | Where-Object { Test-Match $_ })

$repos = @((aws ecr describe-repositories --region $region --output json | ConvertFrom-Json).repositories)
$matchingRepos = @($repos | Where-Object { Test-Match $_.repositoryName } | Select-Object repositoryName, repositoryUri, arn)

$queueUrls = @((aws sqs list-queues --region $region --output json | ConvertFrom-Json).QueueUrls)
$matchingQueues = @($queueUrls | Where-Object { Test-Match $_ })

$buckets = @((aws s3api list-buckets --output json | ConvertFrom-Json).Buckets)
$matchingBuckets = @($buckets | Where-Object { Test-Match $_.Name } | Select-Object Name, CreationDate)

$logGroups = @((aws logs describe-log-groups --region $region --output json | ConvertFrom-Json).logGroups)
$matchingLogGroups = @($logGroups | Where-Object { Test-Match $_.logGroupName } | Select-Object logGroupName, arn, storedBytes)

$metricAlarms = @((aws cloudwatch describe-alarms --region $region --output json | ConvertFrom-Json).MetricAlarms)
$compositeAlarms = @((aws cloudwatch describe-alarms --region $region --alarm-types CompositeAlarm --output json | ConvertFrom-Json).CompositeAlarms)
$matchingMetricAlarms = @($metricAlarms | Where-Object { Test-Match $_.AlarmName } | Select-Object AlarmName, StateValue, Namespace)
$matchingCompositeAlarms = @($compositeAlarms | Where-Object { Test-Match $_.AlarmName } | Select-Object AlarmName, StateValue)

$roles = @((aws iam list-roles --output json | ConvertFrom-Json).Roles)
$roleInlineMatches = @()
foreach ($role in $roles) {
  $policyNames = @((aws iam list-role-policies --role-name $role.RoleName --output json | ConvertFrom-Json).PolicyNames)
  $matchedPolicies = @($policyNames | Where-Object { Test-Match $_ })
  if ((Test-Match $role.RoleName) -or $matchedPolicies.Count -gt 0) {
    $roleInlineMatches += [PSCustomObject]@{
      roleName = $role.RoleName
      roleArn = $role.Arn
      matchedInlinePolicies = $matchedPolicies
    }
  }
}

$ssmParams = @()
$nextToken = $null
while ($true) {
  if ($nextToken) {
    $resp = aws ssm get-parameters-by-path --region $region --path /vercel-clone/ --recursive --with-decryption --next-token $nextToken --output json | ConvertFrom-Json
  } else {
    $resp = aws ssm get-parameters-by-path --region $region --path /vercel-clone/ --recursive --with-decryption --output json | ConvertFrom-Json
  }
  if ($resp.Parameters) { $ssmParams += $resp.Parameters }
  if (-not $resp.NextToken) { break }
  $nextToken = $resp.NextToken
}
$ssmParams = @($ssmParams | Select-Object Name, Type, LastModifiedDate, Version)

$servhubStatus = aws ecs describe-services --region $region --cluster servhub-mini-cluster --services servhub-mini-builder-service --output json | ConvertFrom-Json
$servhubSummary = if ($servhubStatus.services.Count -gt 0) {
  $s = $servhubStatus.services[0]
  [PSCustomObject]@{
    cluster = 'servhub-mini-cluster'
    service = $s.serviceName
    status = $s.status
    desired = $s.desiredCount
    running = $s.runningCount
    pending = $s.pendingCount
    taskDefinition = $s.taskDefinition
    deployments = @($s.deployments | Select-Object status, desiredCount, runningCount, pendingCount, rolloutState)
  }
} else {
  [PSCustomObject]@{ cluster='servhub-mini-cluster'; service='servhub-mini-builder-service'; status='NOT_FOUND' }
}

$result = [PSCustomObject]@{
  region = $region
  matchTerm = $needle
  ecs = [PSCustomObject]@{
    clusters = $matchingClusters
    services = $ecsServices
    taskDefinitions = $matchingTaskDefs
  }
  ecr = [PSCustomObject]@{ repositories = $matchingRepos }
  sqs = [PSCustomObject]@{ queues = $matchingQueues }
  s3 = [PSCustomObject]@{ buckets = $matchingBuckets }
  cloudwatch = [PSCustomObject]@{
    logGroups = $matchingLogGroups
    metricAlarms = $matchingMetricAlarms
    compositeAlarms = $matchingCompositeAlarms
  }
  iam = [PSCustomObject]@{ rolesAndInlinePolicies = $roleInlineMatches }
  ssm = [PSCustomObject]@{ parametersUnderPath = $ssmParams }
  servhubMiniStatus = $servhubSummary
}

$result | ConvertTo-Json -Depth 10
