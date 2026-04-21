# CloudWatch Alarms for Builder Runtime

## Required Alarms

1. DLQ has messages
   - Metric: `ApproximateNumberOfMessagesVisible`
   - Namespace: `AWS/SQS`
   - QueueName: `<SQS_DLQ_NAME>`
   - Threshold: `>= 1` for `1 datapoint / 5 min`
   - Action: SNS notification to operator email/slack

2. Builder service task count unexpectedly low
   - Metric: `RunningTaskCount`
   - Namespace: `ECS/ContainerInsights` (or ECS service metrics)
   - ClusterName: `servhub-mini-cluster`
   - ServiceName: `servhub-mini-builder-service`
   - Threshold: `< 1` for `2 datapoints / 5 min`

3. Builder failures in logs (optional but useful)
   - Log metric filter on `/ecs/servhub-mini-builder`
   - Pattern: `Build failed for deployment`
   - Alarm threshold: `>= 1` per 5 minutes

## Suggested Dashboards

1. SQS queue depth main + DLQ
2. ECS CPU/memory usage for builder tasks
3. Build success/failure counts from Supabase or log metrics

## Retention

- Keep builder logs for at least 7 days (14 preferred for labs)
