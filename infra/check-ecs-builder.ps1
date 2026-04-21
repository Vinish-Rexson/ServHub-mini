$ErrorActionPreference = "Stop"
$env:AWS_PAGER = ""

$region = "ap-south-1"
$cluster = "vercel-clone-cluster"
$service = "vercel-clone-builder-service"

aws ecs describe-services `
  --region $region `
  --cluster $cluster `
  --services $service `
  --query "services[0].{taskDef:taskDefinition,status:status,desired:desiredCount,running:runningCount,pending:pendingCount,events:events[0:8].message}" `
  --output json
