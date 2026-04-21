$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true
$env:AWS_PAGER = ""

$region = "ap-south-1"
$accountId = "421454275395"
$repoName = "vercel-clone-builder"
$repoUri = "$accountId.dkr.ecr.$region.amazonaws.com/$repoName"
$cluster = "vercel-clone-cluster"
$service = "vercel-clone-builder-service"

Write-Output "Checking Docker daemon..."
docker version | Out-Null

Write-Output "Logging in to ECR..."
aws ecr get-login-password --region $region |
  docker login --username AWS --password-stdin "$accountId.dkr.ecr.$region.amazonaws.com"

Write-Output "Building builder image..."
Set-Location "$PSScriptRoot\..\apps\builder"
docker build -t "$repoUri:latest" .

Write-Output "Pushing image..."
docker push "$repoUri:latest"

Write-Output "Forcing ECS rollout..."
aws ecs update-service `
  --region $region `
  --cluster $cluster `
  --service $service `
  --force-new-deployment `
  --desired-count 1 `
  | Out-Null

Write-Output "Done. Current service status:"
aws ecs describe-services `
  --region $region `
  --cluster $cluster `
  --services $service `
  --query "services[0].{taskDef:taskDefinition,desired:desiredCount,running:runningCount,pending:pendingCount,status:status}" `
  --output table
