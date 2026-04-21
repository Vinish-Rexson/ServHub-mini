# Production Environment Mapping

## API (apps/api)

- DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-<n>-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true
- DIRECT_DATABASE_URL=postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres?sslmode=require
- SUPABASE_URL=https://<ref>.supabase.co
- SUPABASE_SERVICE_ROLE_KEY=<supabase_service_role_key>
- GITHUB_CLIENT_ID=<github_client_id>
- GITHUB_CLIENT_SECRET=<github_client_secret>
- GITHUB_WEBHOOK_SECRET=<webhook_secret>
- AWS_REGION=<region>
- SQS_QUEUE_URL=https://sqs.<region>.amazonaws.com/<account-id>/<queue-name>
- PLATFORM_DOMAIN=<platform-domain>
- API_BASE_URL=https://api.<platform-domain>
- JWT_SECRET=<jwt_secret>

## Builder (apps/builder)

- AWS_REGION=<region>
- SQS_QUEUE_URL=https://sqs.<region>.amazonaws.com/<account-id>/<queue-name>
- S3_BUCKET_NAME=<deployment-bucket>
- SUPABASE_URL=https://<ref>.supabase.co
- SUPABASE_SERVICE_ROLE_KEY=<supabase_service_role_key>
- PLATFORM_DOMAIN=<platform-domain>
- SQS_VISIBILITY_TIMEOUT_SECONDS=600
- SQS_WAIT_TIME_SECONDS=20

## Notes

- Use pooled URL on port 6543 for app runtime connections.
- Use direct URL on db.<ref>.supabase.co:5432 for migrations.
- URL-encode special characters in passwords (for example @ -> %40).
