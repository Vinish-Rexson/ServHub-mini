$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true
$env:AWS_PAGER = ""

$region = "ap-south-1"
$accountId = "421454275395"
$repoName = "servhub-mini-builder"
$repoUri = "$accountId.dkr.ecr.$region.amazonaws.com/$repoName"
$cluster = "servhub-mini-cluster"
$service = "servhub-mini-builder-service"

function Assert-LastExitCode {
  param([string]$Step)
  if ($LASTEXITCODE -ne 0) {
    throw "$Step failed with exit code $LASTEXITCODE"
  }
}

Write-Output "Checking Docker daemon..."
docker version | Out-Null
Assert-LastExitCode "Docker daemon check"

Write-Output "Logging in to ECR..."
aws ecr get-login-password --region $region |
  docker login --username AWS --password-stdin "$accountId.dkr.ecr.$region.amazonaws.com"
Assert-LastExitCode "ECR login"

Write-Output "Building builder image..."
Set-Location "$PSScriptRoot\..\apps\builder"
docker build -t "${repoUri}:latest" .
Assert-LastExitCode "Docker build"

Write-Output "Pushing image..."
docker push "${repoUri}:latest"
Assert-LastExitCode "Docker push"

Write-Output "Forcing ECS rollout..."
aws ecs update-service `
  --region $region `
  --cluster $cluster `
  --service $service `
  --force-new-deployment `
  --desired-count 1 `
  | Out-Null
Assert-LastExitCode "ECS service update"

Write-Output "Done. Current service status:"
aws ecs describe-services `
  --region $region `
  --cluster $cluster `
  --services $service `
  --query "services[0].{taskDef:taskDefinition,desired:desiredCount,running:runningCount,pending:pendingCount,status:status}" `
  --output table
