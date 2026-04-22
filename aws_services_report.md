# ServHub-Mini — AWS Services Report
> **Account:** `421454275395` | **Primary Region:** `ap-south-1` (Mumbai)  
> **Generated:** 2026-04-22 | **Source:** AWS CLI live queries + infra scripts

---

## 🖥️ Hosting Layer (EC2-based Production Stack)

These services make up the live, user-facing production environment.

| # | Service | Resource Name | Details |
|---|---------|---------------|---------|
| 1 | **Amazon EC2** | `servhub-prod` | `t3.small`, Ubuntu 24.04 LTS (`ami-0f58b397bc5c1f2e8`), 20 GB gp3 EBS volume |
| 2 | **Amazon EC2 — Key Pair** | `servhub-key` | SSH keypair for server access |
| 3 | **Amazon EC2 — Security Group** | `servhub-sg` | Ports: 22 (SSH – your IP only), 80 (HTTP – 0.0.0.0/0), 443 (HTTPS – 0.0.0.0/0) |
| 4 | **Amazon ECR** | `servhub-api` | Docker repo for API service — **6 images** pushed (`:latest` tagged) |
| 5 | **Amazon ECR** | `servhub-builder` | Docker repo for Builder service — **5 images** pushed (`:latest` tagged) |
| 6 | **Amazon ECR** | `servhub-mini-builder` | Earlier/alternate ECR repo for builder — **6 images** pushed (`:latest` tagged) |

### What runs on EC2
- **Nginx** — Reverse proxy + static file server
  - `servhub.4istudios.in` → serves `/var/www/dashboard` (React SPA)
  - `api-servhub.4istudios.in` → proxies to `localhost:3001`
- **Docker container: `servhub-api`** — Node.js/TypeScript REST API (port 3001)
- **Docker container: `servhub-builder`** — Build job runner (consumes SQS)

---

## ⚙️ Infrastructure / Backend Services

These services power the application's build pipeline and deployment system.

| # | Service | Resource Name | Details |
|---|---------|---------------|---------|
| 7 | **Amazon SQS** | `servhub-mini-builds` | Main build job queue. Visibility timeout: 600s, Long polling: 20s, Retention: 24h, SSE enabled |
| 8 | **Amazon SQS — DLQ** | `servhub-mini-builds-dlq` | Dead-letter queue. Max receive count: 3 before moving failed messages here |
| 9 | **Amazon S3** | `servhub-mini-deployments-421454275395` | Stores built deployment artifacts. Versioning enabled, public access blocked |
| 10 | **Amazon CloudFront** | `d3kltcnwncnt95.cloudfront.net` | CDN distribution serving built user-project files from S3 over HTTPS |
| 11 | **Amazon ECS** (Cluster) | `servhub-mini-cluster` | Fargate cluster for running builder tasks |
| 12 | **Amazon ECS** (Service) | `servhub-mini-builder-service` | ECS service, capacity: FARGATE_SPOT (weight 1) + FARGATE (base 1) |
| 13 | **Amazon ECS** (Task Def) | `servhub-mini-builder` | FARGATE, 0.5 vCPU / 1 GB RAM, pulls image from ECR |

---

## 🔐 IAM & Security

| # | Service | Resource Name | Purpose |
|---|---------|---------------|---------|
| 14 | **AWS IAM — User** | `servhub-mini-api` | API runtime user — SQS send/receive + ECR push access |
| 15 | **AWS IAM — Role** | `servhub-mini-builder-task-role` | ECS task role — SQS consume + S3 read/write access |
| 16 | **AWS IAM — Role** | `ecsTaskExecutionRole` | ECS execution role — pulls ECR images + reads SSM secrets |

---

## 🔧 Configuration & Observability

| # | Service | Resource Name | Details |
|---|---------|---------------|---------|
| 17 | **AWS SSM Parameter Store** | `/servhub-mini/builder/SUPABASE_URL` | String — Supabase project URL for builder tasks |
| 18 | **AWS SSM Parameter Store** | `/servhub-mini/builder/SUPABASE_SERVICE_ROLE_KEY` | SecureString — encrypted Supabase service key |
| 19 | **Amazon CloudWatch Logs** | `/ecs/servhub-mini-builder` | ECS builder task logs, 14-day retention |
| 20 | **Amazon CloudWatch Alarm** | `servhub-mini-builds-dlq-visible` | Fires when DLQ has >= 1 visible message (5-min period) |

---

## 📊 Summary — All 20 Resources by Category

```
HOSTING (EC2 stack)
├── EC2 Instance         servhub-prod             (t3.small, Ubuntu 24.04)
├── EC2 Key Pair         servhub-key
├── EC2 Security Group   servhub-sg
├── ECR Repository       servhub-api              (6 images, :latest)
├── ECR Repository       servhub-builder          (5 images, :latest)
└── ECR Repository       servhub-mini-builder     (6 images, :latest)

INFRASTRUCTURE / PIPELINE
├── SQS Queue            servhub-mini-builds      (main)
├── SQS Queue            servhub-mini-builds-dlq  (dead-letter)
├── S3 Bucket            servhub-mini-deployments-421454275395
├── CloudFront           d3kltcnwncnt95.cloudfront.net
├── ECS Cluster          servhub-mini-cluster
├── ECS Service          servhub-mini-builder-service
└── ECS Task Definition  servhub-mini-builder

IAM & SECURITY
├── IAM User             servhub-mini-api
├── IAM Role             servhub-mini-builder-task-role
└── IAM Role             ecsTaskExecutionRole

OBSERVABILITY & CONFIG
├── SSM Parameter        /servhub-mini/builder/SUPABASE_URL
├── SSM Parameter        /servhub-mini/builder/SUPABASE_SERVICE_ROLE_KEY
├── CloudWatch Logs      /ecs/servhub-mini-builder
└── CloudWatch Alarm     servhub-mini-builds-dlq-visible
```

**Total: 20 AWS resources across 9 distinct AWS services**

---

## 🌐 Non-AWS Services Used Alongside AWS

| Service | Role |
|---------|------|
| **Supabase** | PostgreSQL database + Auth (project: `xkldqliccvgrfnckrlyw`) |
| **Cloudflare** | DNS + TLS proxy in front of EC2 (A records for `servhub.*` and `api-servhub.*`) |
| **GitHub OAuth App** | GitHub repository integration + OAuth login flow |

---

## ⚠️ Issues Found

> [!CAUTION]
> **S3 Bucket Name Mismatch** — `deploy.ps1` and `apps/api/.env` reference `servhub-deployments-prod`, but this bucket does **not exist** (returns `NoSuchBucket`). The actual provisioned bucket is `servhub-mini-deployments-421454275395` (created by `infra/provision-builder.ps1`). You must update `S3_BUCKET_NAME` in `.env` to fix deployments.

> [!NOTE]
> EC2, ECS, CloudFront, and CloudWatch data was sourced from infra scripts — the `servhub-mini-api` IAM user has scope-limited permissions and those CLI calls returned `AccessDenied`. SQS queue attributes and all 3 ECR repos were confirmed live via CLI.
