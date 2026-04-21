# AWS Resource Checklist (Phase 3)

This checklist follows dependency order to avoid circular setup issues.

## 1) Create SQS queue + DLQ

1. Create DLQ: `<SQS_DLQ_NAME>`
2. Create main queue: `<SQS_QUEUE_NAME>`
3. Configure main queue:
   - Visibility timeout: 600
   - Receive message wait time: 20
   - Redrive policy: maxReceiveCount=3, DLQ=`<SQS_DLQ_NAME>`

## 2) Create S3 bucket for deployments

1. Create bucket: `<S3_BUCKET_NAME>` in `<REGION>`
2. Keep block public access enabled
3. Enable versioning (recommended)

## 3) Create IAM policies and attach roles

1. Create policy from `iam-policies/api-role-policy.json`
2. Attach to API runtime role (service running apps/api)
3. Create policy from `iam-policies/builder-task-role-policy.json`
4. Attach to `vercel-clone-builder-task-role`
5. Ensure execution role has `AmazonECSTaskExecutionRolePolicy`

## 4) Create SSM parameters for builder secrets

1. `/vercel-clone/builder/supabase-url` (String)
2. `/vercel-clone/builder/supabase-service-role-key` (SecureString)

## 5) Build and push builder image to ECR

1. Create ECR repo: `vercel-clone-builder`
2. Authenticate Docker to ECR
3. Build image from `apps/builder`
4. Push tag `latest`

## 6) Create ECS task definition and service

1. Replace placeholders in `ecs-task-definition.builder.template.json`
2. Register task definition
3. Create ECS service:
   - Cluster: `vercel-clone-cluster`
   - Desired count: 1
   - Capacity provider strategy:
     - FARGATE_SPOT weight 1
     - FARGATE weight 0, base 1
4. Network:
   - Private subnets preferred
   - Security group with outbound internet (NAT) for GitHub clone and npm install

## 7) CloudWatch logs and alarm baselines

1. Create log group `/ecs/vercel-clone-builder`
2. Set retention 7-14 days
3. Create DLQ alarm (see `cloudwatch-alarms.md`)

## 8) Verification run

1. Trigger manual deploy through API route
2. Confirm one message appears then is consumed from SQS
3. Check ECS logs for build steps
4. Verify `deployments.status` transitions in Supabase
5. Verify build artifacts exist in S3 under `deployments/<deploymentId>/`

## 9) Failure-path verification

1. Trigger deployment with intentionally broken build
2. Confirm status becomes FAILED
3. Confirm message retries then ends in DLQ after max attempts

## 10) Commit state

Commit Phase 3 infra files and link to actual created resource names in this document for team reproducibility.
