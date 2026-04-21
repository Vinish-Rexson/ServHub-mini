# Vercel Clone — Full Project Spec
> Cloud Computing Lab Mini Project  
> Stack: Node.js + Fastify · React + Vite · Supabase (Postgres + Realtime) · AWS SQS · AWS ECS (Spot) · AWS S3 · AWS CloudFront

---

## Project Overview

Build a simplified Vercel-like platform where users connect a GitHub repository, trigger builds on every push, and get a public subdomain to access their deployed React app.

**User flow:**
1. User signs up / logs in
2. Connects a GitHub repo via GitHub OAuth App
3. Platform registers a webhook on the repo
4. On every `git push` to `main`, a build is triggered automatically
5. ECS Spot task clones repo, runs `npm run build`, uploads `build/` to S3
6. User gets a public URL: `{project-slug}.{your-domain}.com`
7. Dashboard shows live build status + logs via Supabase Realtime

---

## Repository Structure

```
vercel-clone/
├── apps/
│   ├── api/                  # Fastify backend
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── auth.ts
│   │   │   │   ├── projects.ts
│   │   │   │   ├── deployments.ts
│   │   │   │   └── webhook.ts
│   │   │   ├── services/
│   │   │   │   ├── github.ts
│   │   │   │   ├── sqs.ts
│   │   │   │   ├── ecs.ts
│   │   │   │   └── supabase.ts
│   │   │   ├── lib/
│   │   │   │   └── prisma.ts
│   │   │   └── index.ts
│   │   ├── prisma/
│   │   │   └── schema.prisma
│   │   └── package.json
│   │
│   ├── dashboard/            # React + Vite frontend
│   │   ├── src/
│   │   │   ├── pages/
│   │   │   ├── components/
│   │   │   └── lib/
│   │   │       └── supabase.ts
│   │   └── package.json
│   │
│   └── builder/              # ECS build worker (Node.js script)
│       ├── src/
│       │   └── index.ts      # Polls SQS, clones, builds, uploads
│       ├── Dockerfile
│       └── package.json
│
├── infra/                    # AWS config / IaC (optional Terraform)
└── docker-compose.yml        # Local dev
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| API server | Node.js + Fastify |
| Frontend dashboard | React + Vite |
| Database | Supabase (Postgres) |
| Realtime | Supabase Realtime |
| ORM | Prisma |
| Build queue | AWS SQS (Standard Queue) |
| Build worker | AWS ECS Fargate Spot |
| Static file storage | AWS S3 |
| CDN | AWS CloudFront |
| Auth | Supabase Auth (or GitHub OAuth) |
| Container registry | AWS ECR |

---

## Database Schema (Prisma)

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")          // Supabase pooler port 6543 for API
  directUrl = env("DIRECT_DATABASE_URL")  // Supabase direct port 5432 for migrations
}

model User {
  id            String    @id @default(uuid())
  email         String    @unique
  githubId      String?   @unique
  githubToken   String?   // encrypted, store GitHub OAuth access token
  avatarUrl     String?
  createdAt     DateTime  @default(now())

  projects      Project[]
}

model Project {
  id            String    @id @default(uuid())
  userId        String
  name          String
  slug          String    @unique   // used for subdomain: {slug}.yourplatform.dev
  repoUrl       String              // https://github.com/owner/repo
  repoFullName  String              // owner/repo
  branch        String    @default("main")
  webhookId     Int?                // GitHub webhook ID for cleanup
  envVars       Json?               // encrypted key-value pairs
  createdAt     DateTime  @default(now())

  user          User      @relation(fields: [userId], references: [id])
  deployments   Deployment[]
}

model Deployment {
  id            String            @id @default(uuid())
  projectId     String
  commitSha     String
  commitMessage String?
  branch        String
  status        DeploymentStatus  @default(QUEUED)
  buildLogs     BuildLog[]
  s3Key         String?           // deployments/{id}/  (set after successful upload)
  deployedUrl   String?           // full public URL
  createdAt     DateTime          @default(now())
  updatedAt     DateTime          @updatedAt
  finishedAt    DateTime?

  project       Project           @relation(fields: [projectId], references: [id])
}

model BuildLog {
  id            String    @id @default(uuid())
  deploymentId  String
  message       String
  level         LogLevel  @default(INFO)
  timestamp     DateTime  @default(now())

  deployment    Deployment @relation(fields: [deploymentId], references: [id])
}

enum DeploymentStatus {
  QUEUED
  BUILDING
  UPLOADING
  READY
  FAILED
  CANCELLED
}

enum LogLevel {
  INFO
  WARN
  ERROR
}
```

**Supabase Realtime — enable on these tables:**
- `deployments` — subscribe by `project_id` to update build status on dashboard
- `build_logs` — subscribe by `deployment_id` to stream logs live

Enable via Supabase dashboard: Database → Replication → enable for `deployments` and `build_logs`.

---

## Environment Variables

### API server (`apps/api/.env`)
```env
# Supabase
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres
DIRECT_DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres
SUPABASE_URL=https://[ref].supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# GitHub OAuth App
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GITHUB_WEBHOOK_SECRET=random_secret_string   # for validating webhook payloads

# AWS
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
SQS_QUEUE_URL=https://sqs.ap-south-1.amazonaws.com/{account-id}/vercel-clone-builds

# App
PORT=3001
JWT_SECRET=your_jwt_secret
PLATFORM_DOMAIN=yourplatform.dev
```

### Builder worker (`apps/builder/.env`)
```env
# AWS
AWS_REGION=ap-south-1
SQS_QUEUE_URL=https://sqs.ap-south-1.amazonaws.com/{account-id}/vercel-clone-builds
S3_BUCKET_NAME=vercel-clone-deployments

# Supabase (direct connection for build worker)
SUPABASE_URL=https://[ref].supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

---

## AWS SQS Configuration

**Queue type:** Standard Queue (not FIFO — ordering not required, higher throughput)

**Queue settings:**
```
Queue name:               vercel-clone-builds
Visibility timeout:       600 seconds (10 min — must exceed max build time)
Message retention:        86400 seconds (1 day)
Receive message wait:     20 seconds (long polling — reduces empty receives)
Max receive count:        3 (before sending to DLQ)
Dead Letter Queue name:   vercel-clone-builds-dlq
```

**SQS message schema** (JSON body sent by API on each push):
```json
{
  "deploymentId": "uuid",
  "projectId": "uuid",
  "repoFullName": "owner/repo",
  "repoUrl": "https://github.com/owner/repo",
  "branch": "main",
  "commitSha": "abc123",
  "commitMessage": "feat: add new component",
  "envVars": {
    "REACT_APP_API_URL": "https://api.yourplatform.dev"
  }
}
```

**IAM policy for SQS** (attach to your ECS task role and API server role):
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sqs:SendMessage",
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes",
        "sqs:ChangeMessageVisibility"
      ],
      "Resource": "arn:aws:sqs:ap-south-1:{account-id}:vercel-clone-builds"
    }
  ]
}
```

---

## AWS S3 Configuration

**Bucket name:** `vercel-clone-deployments`  
**Region:** `ap-south-1`

**Bucket structure:**
```
vercel-clone-deployments/
└── deployments/
    └── {deploymentId}/
        ├── index.html
        ├── static/
        │   ├── js/
        │   └── css/
        └── asset-manifest.json
```

**Bucket policy** (allow CloudFront OAC to read):
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudfront.amazonaws.com"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::vercel-clone-deployments/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::{account-id}:distribution/{distribution-id}"
        }
      }
    }
  ]
}
```

**IAM policy for S3** (attach to ECS task role):
```json
{
  "Effect": "Allow",
  "Action": [
    "s3:PutObject",
    "s3:GetObject",
    "s3:DeleteObject",
    "s3:ListBucket"
  ],
  "Resource": [
    "arn:aws:s3:::vercel-clone-deployments",
    "arn:aws:s3:::vercel-clone-deployments/*"
  ]
}
```

---

## AWS ECS Configuration

### Cluster
```
Cluster name:     vercel-clone-cluster
Infrastructure:   AWS Fargate (Spot capacity provider)
```

### Task Definition
```
Family name:          vercel-clone-builder
Launch type:          FARGATE
CPU:                  1024 (1 vCPU)
Memory:               2048 MB (2 GB)
Task role:            vercel-clone-task-role  (has SQS + S3 permissions)
Execution role:       ecsTaskExecutionRole

Container:
  Name:               builder
  Image:              {account-id}.dkr.ecr.ap-south-1.amazonaws.com/vercel-clone-builder:latest
  Essential:          true
  Environment:        inject via ECS secrets / SSM Parameter Store
  Log configuration:
    logDriver:        awslogs
    options:
      awslogs-group:        /ecs/vercel-clone-builder
      awslogs-region:       ap-south-1
      awslogs-stream-prefix: ecs
```

### Service (for continuous SQS polling)
```
Service name:       vercel-clone-builder-service
Task definition:    vercel-clone-builder
Launch type:        FARGATE
Capacity provider:  FARGATE_SPOT (weight: 1) + FARGATE (weight: 0, base: 1 as fallback)
Desired count:      1
Min healthy %:      0
Max healthy %:      200
```

> The service keeps 1 task running at all times. The task polls SQS in a loop.  
> FARGATE_SPOT saves ~70% cost. FARGATE as base=1 fallback handles spot reclamations.

### Dockerfile for builder (`apps/builder/Dockerfile`)
```dockerfile
FROM node:20-alpine

# Install git
RUN apk add --no-cache git

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

CMD ["node", "dist/index.js"]
```

---

## Builder Worker Logic (`apps/builder/src/index.ts`)

```typescript
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, ChangeMessageVisibilityCommand } from "@aws-sdk/client-sqs";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import { execSync, spawn } from "child_process";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import mime from "mime-types";
import { rimraf } from "rimraf";

const sqs = new SQSClient({ region: process.env.AWS_REGION });
const s3 = new S3Client({ region: process.env.AWS_REGION });
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const QUEUE_URL = process.env.SQS_QUEUE_URL!;
const BUCKET = process.env.S3_BUCKET_NAME!;
const BUILD_DIR = "/tmp/builds";

async function log(deploymentId: string, message: string, level = "INFO") {
  console.log(`[${level}] ${message}`);
  await supabase.from("build_logs").insert({ deployment_id: deploymentId, message, level });
}

async function updateStatus(deploymentId: string, status: string, extra = {}) {
  await supabase.from("deployments").update({ status, ...extra }).eq("id", deploymentId);
}

async function processMessage(body: string, receiptHandle: string) {
  const job = JSON.parse(body);
  const { deploymentId, repoUrl, commitSha, envVars = {} } = job;
  const cloneDir = `${BUILD_DIR}/${deploymentId}`;

  try {
    await updateStatus(deploymentId, "BUILDING");
    await log(deploymentId, `Starting build for commit ${commitSha}`);

    // Clone
    await log(deploymentId, `Cloning ${repoUrl}`);
    execSync(`git clone --depth 1 ${repoUrl} ${cloneDir}`, { stdio: "pipe" });
    execSync(`git -C ${cloneDir} checkout ${commitSha}`, { stdio: "pipe" });

    // Install
    await log(deploymentId, "Running npm install...");
    execSync(`npm ci`, { cwd: cloneDir, stdio: "pipe" });

    // Build — stream output as logs
    await log(deploymentId, "Running npm run build...");
    await new Promise<void>((resolve, reject) => {
      const env = { ...process.env, ...envVars, CI: "false" };
      const build = spawn("npm", ["run", "build"], { cwd: cloneDir, env });
      build.stdout.on("data", async (d) => log(deploymentId, d.toString().trim()));
      build.stderr.on("data", async (d) => log(deploymentId, d.toString().trim(), "WARN"));
      build.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Build exited with code ${code}`)));
    });

    // Upload build/ to S3
    await updateStatus(deploymentId, "UPLOADING");
    await log(deploymentId, "Uploading to S3...");
    const buildOutput = join(cloneDir, "build");
    await uploadDirectory(buildOutput, `deployments/${deploymentId}`);

    // Mark ready
    const deployedUrl = `https://${job.projectSlug}.yourplatform.dev`;
    await updateStatus(deploymentId, "READY", {
      s3_key: `deployments/${deploymentId}`,
      deployed_url: deployedUrl,
      finished_at: new Date().toISOString(),
    });
    await log(deploymentId, `Build complete. Live at ${deployedUrl}`);

    // Delete SQS message on success
    await sqs.send(new DeleteMessageCommand({ QueueUrl: QUEUE_URL, ReceiptHandle: receiptHandle }));
  } catch (err: any) {
    await log(deploymentId, err.message, "ERROR");
    await updateStatus(deploymentId, "FAILED", { finished_at: new Date().toISOString() });
    // Do NOT delete message — let SQS retry up to maxReceiveCount, then DLQ
  } finally {
    await rimraf(cloneDir); // cleanup
  }
}

async function uploadDirectory(dir: string, s3Prefix: string) {
  const walk = (d: string): string[] => {
    const entries = readdirSync(d, { withFileTypes: true });
    return entries.flatMap((e) =>
      e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]
    );
  };
  const files = walk(dir);
  await Promise.all(
    files.map((filePath) => {
      const key = `${s3Prefix}/${filePath.replace(dir + "/", "")}`;
      const body = readFileSync(filePath);
      const contentType = mime.lookup(filePath) || "application/octet-stream";
      return s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }));
    })
  );
}

// Main polling loop
async function poll() {
  console.log("Builder worker started. Polling SQS...");
  while (true) {
    try {
      const result = await sqs.send(new ReceiveMessageCommand({
        QueueUrl: QUEUE_URL,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 20,      // long polling
        VisibilityTimeout: 600,
      }));
      if (result.Messages?.length) {
        const msg = result.Messages[0];
        await processMessage(msg.Body!, msg.ReceiptHandle!);
      }
    } catch (err) {
      console.error("Poll error:", err);
      await new Promise((r) => setTimeout(r, 5000)); // backoff on error
    }
  }
}

poll();
```

---

## API Routes (`apps/api/src/`)

### GitHub OAuth flow (`routes/auth.ts`)
```
GET  /auth/github              → redirect to GitHub OAuth
GET  /auth/github/callback     → exchange code for token, upsert User in DB, return JWT
GET  /auth/me                  → return current user (JWT protected)
POST /auth/logout
```

### Projects (`routes/projects.ts`)
```
GET    /projects               → list user's projects
POST   /projects               → create project + register GitHub webhook
GET    /projects/:id           → get project details
DELETE /projects/:id           → delete project + remove GitHub webhook
```

### Deployments (`routes/deployments.ts`)
```
GET  /projects/:id/deployments         → list deployments for a project
GET  /deployments/:deploymentId        → get single deployment + logs
POST /deployments/:deploymentId/cancel → cancel queued deployment
POST /projects/:id/deploy              → trigger manual deployment
```

### Webhook receiver (`routes/webhook.ts`)
```
POST /webhook/github
  1. Validate X-Hub-Signature-256 header using GITHUB_WEBHOOK_SECRET
  2. Parse push event — extract repo, branch, commitSha, commitMessage
  3. Find Project in DB by repoFullName
  4. Create Deployment record with status QUEUED
  5. Send message to SQS
  6. Return 200 immediately
```

---

## GitHub Webhook Setup

When a user creates a project, call the GitHub API to register a webhook:

```typescript
// services/github.ts
async function registerWebhook(repoFullName: string, accessToken: string) {
  const response = await fetch(`https://api.github.com/repos/${repoFullName}/hooks`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "web",
      active: true,
      events: ["push"],
      config: {
        url: `${process.env.API_BASE_URL}/webhook/github`,
        content_type: "json",
        secret: process.env.GITHUB_WEBHOOK_SECRET,
      },
    }),
  });
  const data = await response.json();
  return data.id; // store this as webhookId in Project table for later cleanup
}
```

---

## Reverse Proxy / Serving Layer

The proxy reads the `Host` header, looks up the active deployment in Supabase, and redirects to the CloudFront URL for that deployment's S3 path.

```typescript
// Minimal Fastify proxy plugin
fastify.get("/*", async (req, reply) => {
  const host = req.hostname; // e.g. my-app.yourplatform.dev
  const slug = host.split(".")[0];

  const { data: project } = await supabase
    .from("projects")
    .select("deployments(id, s3_key, status)")
    .eq("slug", slug)
    .eq("deployments.status", "READY")
    .order("created_at", { foreignTable: "deployments", ascending: false })
    .limit(1, { foreignTable: "deployments" })
    .single();

  if (!project?.deployments?.[0]) {
    return reply.code(404).send("No deployment found");
  }

  const { s3_key } = project.deployments[0];
  const cfUrl = `https://${process.env.CLOUDFRONT_DOMAIN}/${s3_key}${req.url}`;
  return reply.redirect(cfUrl);
});
```

> For a cleaner setup, run this proxy as a **separate Fastify service** on a wildcard subdomain (`*.yourplatform.dev → proxy server`), distinct from your main API server.

---

## Supabase Realtime on Frontend

```typescript
// apps/dashboard/src/lib/supabase.ts
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// In your DeploymentPage component:
useEffect(() => {
  const channel = supabase
    .channel(`deployment-${deploymentId}`)
    .on("postgres_changes", {
      event: "UPDATE",
      schema: "public",
      table: "deployments",
      filter: `id=eq.${deploymentId}`,
    }, (payload) => {
      setDeployment(payload.new);
    })
    .on("postgres_changes", {
      event: "INSERT",
      schema: "public",
      table: "build_logs",
      filter: `deployment_id=eq.${deploymentId}`,
    }, (payload) => {
      setLogs((prev) => [...prev, payload.new]);
    })
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}, [deploymentId]);
```

---

## Local Development Setup

```yaml
# docker-compose.yml
services:
  api:
    build: ./apps/api
    ports: ["3001:3001"]
    env_file: ./apps/api/.env
    volumes: ["./apps/api:/app", "/app/node_modules"]

  dashboard:
    build: ./apps/dashboard
    ports: ["3000:3000"]
    env_file: ./apps/dashboard/.env
    volumes: ["./apps/dashboard:/app", "/app/node_modules"]

  builder:
    build: ./apps/builder
    env_file: ./apps/builder/.env
    # Uses real AWS SQS even locally
```

**For local webhook testing:**  
Use [ngrok](https://ngrok.com) or [smee.io](https://smee.io) to expose your local API to GitHub:
```bash
ngrok http 3001
# Set API_BASE_URL=https://xxxx.ngrok.io in .env
```

---

## Implementation Order

1. **Supabase setup** — create project, run Prisma migrations, enable Realtime on `deployments` and `build_logs`
2. **GitHub OAuth** — register OAuth App, implement `/auth/github` flow, store tokens
3. **API skeleton** — Fastify server, project CRUD, webhook receiver endpoint
4. **SQS wiring** — create queue + DLQ, implement SQS producer in webhook handler
5. **Builder worker** — Dockerfile, clone → build → S3 upload loop, log to Supabase
6. **ECS setup** — push image to ECR, create task definition, create Fargate Spot service
7. **CloudFront + proxy** — distribution pointing to S3, reverse proxy reading slug → deployment
8. **Dashboard** — React UI, Supabase Realtime for live logs and status
9. **End-to-end test** — push to GitHub, watch full flow

---

## Key Gotchas

- **Supabase free tier pauses** projects after 1 week of inactivity. Fine for lab use.
- **Use port 6543** (pooler) in `DATABASE_URL` for the ECS builder — ephemeral tasks open many short-lived connections. Use port 5432 (direct) only for `DIRECT_DATABASE_URL` in Prisma migrate.
- **Spot interruption** — ECS gives 2 min warning. Handle `SIGTERM` in the builder to mark deployment as `CANCELLED` so it can be re-queued.
- **Webhook signature validation** is mandatory — always verify `X-Hub-Signature-256` before processing any push event.
- **`CI=false`** in the build env prevents create-react-app from treating warnings as errors and failing the build.
- **S3 paths are immutable per deployment** — never overwrite. Rollback = update the slug → deploymentId mapping in DB.
- **CloudFront needs `index.html` fallback** for React Router — configure the distribution's default root object as `index.html` and add a custom error page (403/404 → `index.html`, 200) for client-side routing.
