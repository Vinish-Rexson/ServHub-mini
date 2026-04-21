# Phase 3 Infrastructure Assets

This folder contains deploy-ready JSON templates and runbooks for AWS runtime wiring:

- SQS + DLQ
- S3 deployment bucket
- ECS task + service for builder worker
- IAM policies for API and builder roles
- CloudWatch logging and monitoring checklist

## Files

- `iam-policies/api-role-policy.json` - API SQS producer permission
- `iam-policies/builder-task-role-policy.json` - Builder SQS consume + S3 object permissions
- `iam-policies/task-execution-extra-policy.json` - Optional execution role pull/log policy extension
- `ecs-task-definition.builder.template.json` - ECS task definition template for builder
- `aws-resource-checklist.md` - Ordered creation checklist with validation commands
- `cloudwatch-alarms.md` - DLQ and worker health alarm recommendations
- `env.production.template.md` - Production env mappings for API and Builder
- `provision-builder.ps1` - idempotent AWS provisioning script for Phase 3 resources
- `push-builder-image.ps1` - build/push builder Docker image and force ECS rollout
- `check-ecs-builder.ps1` - quick ECS service status and recent events

## Provisioning modes

- Default mode skips ECR creation and sets ECS service desired count to 0:
   - `./infra/provision-builder.ps1`
- Full mode includes ECR flow and keeps ECS desired count at 1:
   - `./infra/provision-builder.ps1 -SkipEcr $false`

## How to use

1. Replace placeholders in templates:
   - `<AWS_ACCOUNT_ID>`
   - `<REGION>`
   - `<SQS_QUEUE_NAME>`
   - `<SQS_DLQ_NAME>`
   - `<S3_BUCKET_NAME>`
2. Create IAM policies and attach to corresponding roles.
3. Create/update ECS task definition from the template.
4. Create ECS service with FARGATE_SPOT and fallback FARGATE.
5. Verify SQS polling, status/log updates, and S3 uploads.

See `aws-resource-checklist.md` for the exact sequence.
