import { createHmac, timingSafeEqual } from "crypto";
import type { FastifyInstance } from "fastify";
import { getRequiredEnv } from "../lib/env";
import { prisma } from "../lib/prisma";
import { enqueueBuild } from "../services/sqs";

type GitHubPushPayload = {
  ref: string;
  after: string;
  head_commit?: {
    message?: string;
  };
  repository?: {
    full_name?: string;
    html_url?: string;
  };
};

function toEnvMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const envVars: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === "string") {
      envVars[key] = item;
    } else if (item !== null && item !== undefined) {
      envVars[key] = String(item);
    }
  }

  return envVars;
}

function isValidSignature(rawBody: string, signature: string, secret: string): boolean {
  const computed = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const receivedBuffer = Buffer.from(signature, "utf8");
  const computedBuffer = Buffer.from(computed, "utf8");

  if (receivedBuffer.length !== computedBuffer.length) {
    return false;
  }

  return timingSafeEqual(receivedBuffer, computedBuffer);
}

export async function webhookRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Body: GitHubPushPayload }>(
    "/webhook/github",
    {
      config: {
        rawBody: true,
      },
    },
    async (request, reply) => {
      const signature = request.headers["x-hub-signature-256"];
      if (typeof signature !== "string") {
        return reply.code(401).send({ error: "Missing webhook signature" });
      }

      const webhookSecret = getRequiredEnv("GITHUB_WEBHOOK_SECRET");
      const raw = request.rawBody;
      const rawBody = typeof raw === "string" ? raw : raw?.toString("utf8") ?? "";

      if (!isValidSignature(rawBody, signature, webhookSecret)) {
        return reply.code(401).send({ error: "Invalid webhook signature" });
      }

      const event = request.headers["x-github-event"];
      if (event !== "push") {
        return reply.send({ ok: true, ignored: true });
      }

      const payload = request.body;
      const repoFullName = payload.repository?.full_name;
      const repoUrl = payload.repository?.html_url;
      const commitSha = payload.after;
      const commitMessage = payload.head_commit?.message;
      const branch = payload.ref.replace("refs/heads/", "");

      if (!repoFullName || !repoUrl || !commitSha || !branch) {
        return reply.code(400).send({ error: "Invalid webhook payload" });
      }

      const project = await prisma.project.findFirst({
        where: {
          repoFullName,
          branch,
        },
      });

      if (!project) {
        return reply.send({ ok: true, ignored: true });
      }

      const deployment = await prisma.deployment.create({
        data: {
          projectId: project.id,
          commitSha,
          commitMessage,
          branch,
          status: "QUEUED",
        },
      });

      await enqueueBuild({
        deploymentId: deployment.id,
        projectId: project.id,
        projectSlug: project.slug,
        repoFullName,
        repoUrl,
        branch,
        commitSha,
        commitMessage,
        envVars: toEnvMap(project.envVars),
      });

      return reply.send({ ok: true, deploymentId: deployment.id });
    }
  );
}
