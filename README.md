# Vercel Clone (Mini Project)

This repository is being implemented from the spec in `vercel-clone-spec.md`.

## Current status

- Phase 0 complete: monorepo bootstrap
- Phase 1 core complete: API skeleton with Prisma schema, auth/project/deployment routes, webhook validation, and SQS producer wiring
- Phase 2 core complete: builder worker pipeline (SQS consume, git clone/build, Supabase logs/status, S3 upload)
- Phase 3 pending: AWS runtime wiring (SQS, S3, ECS, IAM)
- Phase 4 pending: dashboard pages + realtime subscriptions

## Monorepo structure

- `apps/api` - Fastify API (auth, projects, deployments, webhook)
- `apps/dashboard` - React + Vite frontend dashboard
- `apps/builder` - SQS worker for build + upload
- `infra` - infrastructure definitions and policies

## Quick start

1. Install dependencies:

	npm install

2. Create env files from templates:

	- copy `apps/api/.env.template` to `apps/api/.env`
	- copy `apps/dashboard/.env.template` to `apps/dashboard/.env`
	- copy `apps/builder/.env.template` to `apps/builder/.env`

3. Generate Prisma client:

	npm run prisma:generate

4. Run API in dev mode:

	npm run dev:api

5. Build API for compile check:

	npm run build:api

## Notes

- Prisma migration requires valid Supabase/Postgres credentials in `apps/api/.env`.
- GitHub OAuth and webhook registration require `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `API_BASE_URL`, and `GITHUB_WEBHOOK_SECRET`.
- Webhook signature validation is implemented and expects `X-Hub-Signature-256`.
