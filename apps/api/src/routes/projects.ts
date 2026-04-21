import { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { requireUser } from "../lib/auth";
import { prisma } from "../lib/prisma";
import { registerWebhook, removeWebhook } from "../services/github";
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "ap-south-1" });
const S3_BUCKET = process.env.S3_BUCKET_NAME ?? "";

async function deleteS3Prefix(prefix: string): Promise<void> {
  if (!S3_BUCKET || !prefix) return;

  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  if (keys.length === 0) return;

  for (let i = 0; i < keys.length; i += 1000) {
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: S3_BUCKET,
        Delete: {
          Objects: keys.slice(i, i + 1000).map((k) => ({ Key: k })),
          Quiet: true,
        },
      })
    );
  }
}

type CreateProjectBody = {
  name: string;
  slug: string;
  repoUrl: string;
  repoFullName: string;
  branch?: string;
  envVars?: Record<string, string>;
};

type ProjectParams = {
  id: string;
};

// Duck-type guard: works across all Prisma versions without importing the class
function isUniqueConstraintError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as Record<string, unknown>).code === "P2002"
  );
}

export async function projectRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/projects", async (request, reply) => {
    const authUser = await requireUser(request, reply);
    if (!authUser) {
      return;
    }

    const projects = await prisma.project.findMany({
      where: { userId: authUser.id },
      orderBy: { createdAt: "desc" },
      include: {
        deployments: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            status: true,
            createdAt: true,
            deployedUrl: true,
          },
        },
      },
    });

    return reply.send(projects);
  });

  fastify.post<{ Body: CreateProjectBody }>("/projects", async (request, reply) => {
    const authUser = await requireUser(request, reply);
    if (!authUser) {
      return;
    }

    const { name, slug, repoUrl, repoFullName, branch = "main", envVars } = request.body;

    if (!name || !slug || !repoUrl || !repoFullName) {
      return reply.code(400).send({ error: "name, slug, repoUrl and repoFullName are required" });
    }

    const user = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: { githubToken: true },
    });

    if (!user?.githubToken) {
      return reply.code(400).send({ error: "GitHub account is not connected" });
    }

    const apiBaseUrl = process.env.API_BASE_URL ?? "";
    const isLocalUrl = apiBaseUrl.includes("localhost") || apiBaseUrl.includes("127.0.0.1");

    let webhookId: number | null = null;

    try {
      if (!isLocalUrl) {
        webhookId = await registerWebhook(repoFullName, user.githubToken);
      } else {
        request.log.warn("Skipping webhook registration: API_BASE_URL is localhost (not publicly reachable)");
      }

      const authenticatedRepoUrl = `https://x-access-token:${user.githubToken}@github.com/${repoFullName}.git`;

      const project = await prisma.project.create({
        data: {
          userId: authUser.id,
          name,
          slug,
          repoUrl: authenticatedRepoUrl,
          repoFullName,
          branch,
          webhookId,
          envVars,
        },
      });

      return reply.code(201).send(project);
    } catch (error) {
      if (webhookId) {
        await removeWebhook(repoFullName, webhookId, user.githubToken).catch(() => undefined);
      }

      if (isUniqueConstraintError(error)) {
        return reply.code(409).send({ error: "Project slug or repository is already in use" });
      }

      request.log.error({ error: String(error) }, "Failed to create project");
      return reply.code(500).send({ error: "Failed to create project: " + String(error) });
    }
  });

  fastify.get<{ Params: ProjectParams }>("/projects/:id", async (request, reply) => {
    const authUser = await requireUser(request, reply);
    if (!authUser) {
      return;
    }

    const project = await prisma.project.findFirst({
      where: {
        id: request.params.id,
        userId: authUser.id,
      },
      include: {
        deployments: {
          orderBy: { createdAt: "desc" },
          take: 20,
        },
      },
    });

    if (!project) {
      return reply.code(404).send({ error: "Project not found" });
    }

    return reply.send(project);
  });

  fastify.delete<{ Params: ProjectParams }>("/projects/:id", async (request, reply) => {
    const authUser = await requireUser(request, reply);
    if (!authUser) {
      return;
    }

    const project = await prisma.project.findFirst({
      where: {
        id: request.params.id,
        userId: authUser.id,
      },
      include: {
        deployments: {
          select: { id: true, s3Key: true },
        },
      },
    });

    if (!project) {
      return reply.code(404).send({ error: "Project not found" });
    }

    const user = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: { githubToken: true },
    });

    if (project.webhookId && user?.githubToken) {
      await removeWebhook(project.repoFullName, project.webhookId, user.githubToken).catch((error) => {
        request.log.warn({ error }, "Failed to remove GitHub webhook during project deletion");
      });
    }

    // Delete all S3 artifacts for every deployment under this project
    const s3Keys = project.deployments
      .map((d: { id: string; s3Key: string | null }) => d.s3Key)
      .filter((k: string | null): k is string => typeof k === "string" && k.length > 0);

    await Promise.allSettled(
      s3Keys.map((key: string) =>
        deleteS3Prefix(key).catch((err: unknown) =>
          request.log.warn({ err, key }, "Failed to delete S3 artifacts for deployment")
        )
      )
    );

    // Deleting the project cascades to deployments and build_logs via FK
    await prisma.project.delete({
      where: { id: project.id },
    });

    return reply.code(204).send();
  });
}
