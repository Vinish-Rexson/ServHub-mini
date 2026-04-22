################################################################################
# ServHub-Mini — CloudWatch Integration Setup
# Run once with ADMIN credentials (not the servhub-mini-api user)
#
# Usage:  .\setup-cloudwatch.ps1
#
# What this does:
#   1.  Updates IAM policy for servhub-mini-api user (adds CloudWatch Logs + Metrics)
#   2.  Creates CloudWatch log groups  /servhub/api  and  /servhub/builder
#   3.  Creates metric filters  (HTTP 5xx errors, slow requests)
#   4.  Creates CloudWatch alarms  (5xx spike, DLQ depth, SQS queue depth)
#   5.  Creates a CloudWatch Dashboard  "ServHub-Overview"
#
# After running this script, re-deploy with:
#   .\deploy.ps1 -Resume
# That will restart the Docker containers with the awslogs log driver so logs
# flow automatically into CloudWatch.
################################################################################

$ErrorActionPreference = "Stop"
$env:AWS_PAGER = ""

# ── Credentials ───────────────────────────────────────────────────────────────
# IAM step (Step 1) requires ADMIN credentials.
# All other steps use the servhub-mini-api key which will have CloudWatch
# permissions after Step 1 completes.
# To run with admin: set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY to your
# admin user's key before calling this script, or log in via 'aws sso login'.
$env:AWS_ACCESS_KEY_ID     = "AKIAWEIFB4NBUESIZAUV"
$env:AWS_SECRET_ACCESS_KEY = "7e+tSz+9hfPHvAdpQNz2tBsTlvXtVw2sezCdQebg"
$env:AWS_DEFAULT_REGION    = "ap-south-1"

$REGION      = "ap-south-1"
$ACCOUNT     = "421454275395"
$API_USER    = "servhub-mini-api"

$LOG_GROUP_API     = "/servhub/api"
$LOG_GROUP_BUILDER = "/servhub/builder"
$LOG_RETENTION     = 14   # days

$SQS_QUEUE_NAME = "servhub-mini-builds"
$SQS_DLQ_NAME   = "servhub-mini-builds-dlq"

function Log($msg)  { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "    OK: $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "    WARN: $msg" -ForegroundColor Yellow }

################################################################################
# 1. UPDATE IAM POLICY — add CloudWatch Logs + Metrics to the API user
################################################################################
Log "Updating IAM inline policy on user: $API_USER"

$apiPolicy = @{
    Version   = "2012-10-17"
    Statement = @(
        @{
            Sid      = "AllowSendBuildJobs"
            Effect   = "Allow"
            Action   = @("sqs:SendMessage","sqs:GetQueueAttributes")
            Resource = "arn:aws:sqs:${REGION}:${ACCOUNT}:servhub-mini-builds"
        },
        @{
            Sid      = "AllowCloudWatchLogs"
            Effect   = "Allow"
            Action   = @(
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:PutLogEvents",
                "logs:DescribeLogGroups",
                "logs:DescribeLogStreams"
            )
            Resource = @(
                "arn:aws:logs:${REGION}:${ACCOUNT}:log-group:/servhub/*",
                "arn:aws:logs:${REGION}:${ACCOUNT}:log-group:/servhub/*:log-stream:*"
            )
        },
        @{
            Sid      = "AllowCloudWatchMetrics"
            Effect   = "Allow"
            Action   = @(
                "cloudwatch:PutMetricData",
                "cloudwatch:GetMetricStatistics",
                "cloudwatch:ListMetrics"
            )
            Resource = "*"
        }
    )
} | ConvertTo-Json -Depth 10

$policyPath = Join-Path $PWD "infra\api-user-policy.json"
$apiPolicy | Set-Content -Encoding utf8 $policyPath

try {
    aws iam put-user-policy `
        --user-name $API_USER `
        --policy-name "servhub-mini-api-policy" `
        --policy-document "file://$policyPath" `
        --region $REGION 2>&1 | Out-Null
    Ok "IAM policy updated with CloudWatch permissions"
} catch {
    Warn "IAM update needs admin credentials. Do this manually in the AWS Console:"
    Warn "  IAM > Users > servhub-mini-api > Permissions > Add inline policy"
    Warn "  Use the policy from: infra\api-user-policy.json"
    Warn "  Then re-run this script. Continuing with other steps..."
}

################################################################################
# 2. CREATE CLOUDWATCH LOG GROUPS
################################################################################
Log "Creating CloudWatch log groups"

foreach ($group in @($LOG_GROUP_API, $LOG_GROUP_BUILDER)) {
    try {
        aws logs create-log-group --log-group-name $group --region $REGION 2>&1 | Out-Null
        Ok "Created log group: $group"
    } catch {
        Ok "Log group already exists (or created): $group"
    }
    aws logs put-retention-policy `
        --log-group-name $group `
        --retention-in-days $LOG_RETENTION `
        --region $REGION
    Ok "Retention set to ${LOG_RETENTION} days for $group"
}

################################################################################
# 3. CREATE METRIC FILTERS
################################################################################
Log "Creating metric filters on $LOG_GROUP_API"

# Filter: HTTP 5xx errors (matches lines like: "POST /api/... 500" or status:500)
aws logs put-metric-filter `
    --log-group-name $LOG_GROUP_API `
    --filter-name "Http5xxErrors" `
    --filter-pattern "[host, user, ts, req, status=5*, size]" `
    --metric-transformations `
        metricName="Http5xxCount",metricNamespace="ServHub/API",metricValue=1,defaultValue=0 `
    --region $REGION
Ok "Metric filter: Http5xxErrors"

# Filter: HTTP 4xx client errors
aws logs put-metric-filter `
    --log-group-name $LOG_GROUP_API `
    --filter-name "Http4xxErrors" `
    --filter-pattern "[host, user, ts, req, status=4*, size]" `
    --metric-transformations `
        metricName="Http4xxCount",metricNamespace="ServHub/API",metricValue=1,defaultValue=0 `
    --region $REGION
Ok "Metric filter: Http4xxErrors"

################################################################################
# 4. CREATE CLOUDWATCH ALARMS
################################################################################
Log "Creating CloudWatch alarms"

# Alarm 1: API 5xx spike — triggers if > 5 errors in 5 minutes
aws cloudwatch put-metric-alarm `
    --alarm-name "servhub-api-5xx-spike" `
    --alarm-description "API is returning too many 5xx errors" `
    --namespace "ServHub/API" `
    --metric-name "Http5xxCount" `
    --statistic "Sum" `
    --period 300 `
    --evaluation-periods 1 `
    --threshold 5 `
    --comparison-operator "GreaterThanOrEqualToThreshold" `
    --treat-missing-data "notBreaching" `
    --region $REGION
Ok "Alarm: servhub-api-5xx-spike"

# Alarm 2: SQS main queue depth — triggers if > 50 messages waiting
aws cloudwatch put-metric-alarm `
    --alarm-name "servhub-sqs-queue-depth" `
    --alarm-description "Build queue has too many pending messages" `
    --namespace "AWS/SQS" `
    --metric-name "ApproximateNumberOfMessagesVisible" `
    --dimensions "Name=QueueName,Value=$SQS_QUEUE_NAME" `
    --statistic "Average" `
    --period 300 `
    --evaluation-periods 2 `
    --threshold 50 `
    --comparison-operator "GreaterThanOrEqualToThreshold" `
    --treat-missing-data "notBreaching" `
    --region $REGION
Ok "Alarm: servhub-sqs-queue-depth"

# Alarm 3: DLQ visible messages (already may exist from provision-builder, upsert is safe)
aws cloudwatch put-metric-alarm `
    --alarm-name "servhub-mini-builds-dlq-visible" `
    --alarm-description "Build jobs are failing — messages in dead-letter queue" `
    --namespace "AWS/SQS" `
    --metric-name "ApproximateNumberOfMessagesVisible" `
    --dimensions "Name=QueueName,Value=$SQS_DLQ_NAME" `
    --statistic "Average" `
    --period 300 `
    --evaluation-periods 1 `
    --threshold 1 `
    --comparison-operator "GreaterThanOrEqualToThreshold" `
    --treat-missing-data "notBreaching" `
    --region $REGION
Ok "Alarm: servhub-mini-builds-dlq-visible"

# Alarm 4: SQS age of oldest message — triggers if message is older than 10 min
aws cloudwatch put-metric-alarm `
    --alarm-name "servhub-sqs-message-age" `
    --alarm-description "Build job has been waiting over 10 minutes" `
    --namespace "AWS/SQS" `
    --metric-name "ApproximateAgeOfOldestMessage" `
    --dimensions "Name=QueueName,Value=$SQS_QUEUE_NAME" `
    --statistic "Maximum" `
    --period 300 `
    --evaluation-periods 1 `
    --threshold 600 `
    --comparison-operator "GreaterThanOrEqualToThreshold" `
    --treat-missing-data "notBreaching" `
    --region $REGION
Ok "Alarm: servhub-sqs-message-age"

################################################################################
# 5. CREATE CLOUDWATCH DASHBOARD — ServHub-Overview
################################################################################
Log "Creating CloudWatch Dashboard: ServHub-Overview"

$dashboardBody = @{
    widgets = @(
        # Row 1: Title
        @{
            type       = "text"
            x          = 0; y = 0; width = 24; height = 2
            properties = @{
                markdown = "# ServHub Production Overview`n**Region:** ap-south-1 (Mumbai) | **Account:** $ACCOUNT"
            }
        },

        # Row 2: SQS Build Queue Depth
        @{
            type       = "metric"
            x          = 0; y = 2; width = 8; height = 6
            properties = @{
                title   = "SQS - Build Queue Depth"
                view    = "timeSeries"
                stacked = $false
                region  = $REGION
                period  = 60
                stat    = "Average"
                metrics = @(
                    @("AWS/SQS","ApproximateNumberOfMessagesVisible","QueueName","servhub-mini-builds"),
                    @("AWS/SQS","ApproximateNumberOfMessagesNotVisible","QueueName","servhub-mini-builds")
                )
            }
        },

        # Row 2: SQS DLQ
        @{
            type       = "metric"
            x          = 8; y = 2; width = 8; height = 6
            properties = @{
                title   = "SQS - Dead Letter Queue"
                view    = "timeSeries"
                stacked = $false
                region  = $REGION
                period  = 60
                stat    = "Sum"
                metrics = @(
                    @("AWS/SQS","ApproximateNumberOfMessagesVisible","QueueName","servhub-mini-builds-dlq",@{color="#d62728"; label="DLQ Messages"})
                )
            }
        },

        # Row 2: SQS message age
        @{
            type       = "metric"
            x          = 16; y = 2; width = 8; height = 6
            properties = @{
                title   = "SQS - Oldest Message Age (seconds)"
                view    = "timeSeries"
                stacked = $false
                region  = $REGION
                period  = 60
                stat    = "Maximum"
                metrics = @(
                    @("AWS/SQS","ApproximateAgeOfOldestMessage","QueueName","servhub-mini-builds",@{label="Message Age"})
                )
            }
        },

        # Row 3: API 5xx errors
        @{
            type       = "metric"
            x          = 0; y = 8; width = 12; height = 6
            properties = @{
                title   = "API - HTTP 5xx Errors"
                view    = "timeSeries"
                stacked = $false
                region  = $REGION
                period  = 300
                stat    = "Sum"
                metrics = @(
                    @("ServHub/API","Http5xxCount",@{color="#d62728"; label="5xx Errors"})
                )
            }
        },

        # Row 3: API 4xx errors
        @{
            type       = "metric"
            x          = 12; y = 8; width = 12; height = 6
            properties = @{
                title   = "API - HTTP 4xx Client Errors"
                view    = "timeSeries"
                stacked = $false
                region  = $REGION
                period  = 300
                stat    = "Sum"
                metrics = @(
                    @("ServHub/API","Http4xxCount",@{color="#ff7f0e"; label="4xx Errors"})
                )
            }
        },

        # Row 4: API Log Insights — recent errors
        @{
            type       = "log"
            x          = 0; y = 14; width = 24; height = 6
            properties = @{
                title   = "API - Recent Error Log Lines"
                region  = $REGION
                view    = "table"
                query   = "SOURCE '$LOG_GROUP_API' | fields @timestamp, @message | filter @message like /error|Error|ERROR|5[0-9][0-9]/ | sort @timestamp desc | limit 50"
            }
        },

        # Row 5: Alarms status
        @{
            type       = "alarm"
            x          = 0; y = 20; width = 24; height = 4
            properties = @{
                title  = "Alarm Status"
                alarms = @(
                    "arn:aws:cloudwatch:${REGION}:${ACCOUNT}:alarm:servhub-api-5xx-spike",
                    "arn:aws:cloudwatch:${REGION}:${ACCOUNT}:alarm:servhub-sqs-queue-depth",
                    "arn:aws:cloudwatch:${REGION}:${ACCOUNT}:alarm:servhub-mini-builds-dlq-visible",
                    "arn:aws:cloudwatch:${REGION}:${ACCOUNT}:alarm:servhub-sqs-message-age"
                )
            }
        }
    )
} | ConvertTo-Json -Depth 15 -Compress

aws cloudwatch put-dashboard `
    --dashboard-name "ServHub-Overview" `
    --dashboard-body $dashboardBody `
    --region $REGION
Ok "Dashboard 'ServHub-Overview' created"

################################################################################
# DONE
################################################################################

Write-Host ""
Write-Host "----------------------------------------------------" -ForegroundColor Green
Write-Host "  CLOUDWATCH SETUP COMPLETE" -ForegroundColor Green
Write-Host "----------------------------------------------------" -ForegroundColor Green
Write-Host ""
Write-Host "  Log Groups:" -ForegroundColor White
Write-Host "    $LOG_GROUP_API         (14 day retention)" -ForegroundColor Gray
Write-Host "    $LOG_GROUP_BUILDER  (14 day retention)" -ForegroundColor Gray
Write-Host ""
Write-Host "  Alarms:" -ForegroundColor White
Write-Host "    servhub-api-5xx-spike       >= 5 errors in 5 min" -ForegroundColor Gray
Write-Host "    servhub-sqs-queue-depth     >= 50 pending jobs" -ForegroundColor Gray
Write-Host "    servhub-mini-builds-dlq-visible  >= 1 DLQ message" -ForegroundColor Gray
Write-Host "    servhub-sqs-message-age     message waiting >= 10 min" -ForegroundColor Gray
Write-Host ""
Write-Host "  Dashboard:" -ForegroundColor White
Write-Host "    https://ap-south-1.console.aws.amazon.com/cloudwatch/home?region=ap-south-1#dashboards:name=ServHub-Overview" -ForegroundColor Cyan
Write-Host ""
Write-Host "---- NEXT STEP --------------------------------------" -ForegroundColor Magenta
Write-Host "  Run:  .\deploy.ps1 -Resume" -ForegroundColor Yellow
Write-Host "  This will restart Docker containers with CloudWatch logging enabled." -ForegroundColor Gray
Write-Host "----------------------------------------------------" -ForegroundColor Green
Write-Host ""
