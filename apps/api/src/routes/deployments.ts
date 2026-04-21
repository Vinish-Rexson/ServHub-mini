import type { FastifyInstance } from "fastify";
import { requireUser } from "../lib/auth";
import { prisma } from "../lib/prisma";
import { enqueueBuild } from "../services/sqs";

type ProjectParams = {
  id: string;
};

type DeploymentParams = {
  deploymentId: string;
};

type ManualDeployBody = {
  commitSha?: string;
  commitMessage?: string;
  branch?: string;
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

export async function deploymentRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Params: ProjectParams }>("/projects/:id/deployments", async (request, reply) => {
    const authUser = await requireUser(request, reply);
    if (!authUser) {
      return;
    }

    const project = await prisma.project.findFirst({
      where: {
        id: request.params.id,
        userId: authUser.id,
      },
      select: { id: true },
    });

    if (!project) {
      return reply.code(404).send({ error: "Project not found" });
    }

    const deployments = await prisma.deployment.findMany({
      where: {
        projectId: project.id,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return reply.send(deployments);
  });

  fastify.get<{ Params: DeploymentParams }>("/deployments/:deploymentId", async (request, reply) => {
    const authUser = await requireUser(request, reply);
    if (!authUser) {
      return;
    }

    const deployment = await prisma.deployment.findUnique({
      where: { id: request.params.deploymentId },
      include: {
        project: {
          select: {
            id: true,
            userId: true,
            name: true,
            slug: true,
          },
        },
        buildLogs: {
          orderBy: { timestamp: "asc" },
        },
      },
    });

    if (!deployment || deployment.project.userId !== authUser.id) {
      return reply.code(404).send({ error: "Deployment not found" });
    }

    return reply.send(deployment);
  });

  fastify.post<{ Params: DeploymentParams }>("/deployments/:deploymentId/cancel", async (request, reply) => {
    const authUser = await requireUser(request, reply);
    if (!authUser) {
      return;
    }

    const deployment = await prisma.deployment.findUnique({
      where: { id: request.params.deploymentId },
      include: {
        project: {
          select: {
            userId: true,
          },
        },
      },
    });

    if (!deployment || deployment.project.userId !== authUser.id) {
      return reply.code(404).send({ error: "Deployment not found" });
    }

    if (deployment.status !== "QUEUED") {
      return reply.code(409).send({ error: "Only queued deployments can be cancelled" });
    }

    const cancelled = await prisma.deployment.update({
      where: {
        id: deployment.id,
      },
      data: {
        status: "CANCELLED",
        finishedAt: new Date(),
      },
    });

    return reply.send(cancelled);
  });

  fastify.post<{ Params: ProjectParams; Body: ManualDeployBody }>("/projects/:id/deploy", async (request, reply) => {
    const authUser = await requireUser(request, reply);
    if (!authUser) {
      return;
    }

    const project = await prisma.project.findFirst({
      where: {
        id: request.params.id,
        userId: authUser.id,
      },
    });

    if (!project) {
      return reply.code(404).send({ error: "Project not found" });
    }

    const branch = request.body.branch?.trim() || project.branch || "main";
    const commitSha = request.body.commitSha?.trim() || branch;

    const deployment = await prisma.deployment.create({
      data: {
        projectId: project.id,
        branch,
        commitSha,
        commitMessage: request.body.commitMessage || "Manual deployment",
        status: "QUEUED",
      },
    });

    await enqueueBuild({
      deploymentId: deployment.id,
      projectId: project.id,
      projectSlug: project.slug,
      repoFullName: project.repoFullName,
      repoUrl: project.repoUrl,
      branch,
      commitSha,
      commitMessage: deployment.commitMessage || undefined,
      envVars: toEnvMap(project.envVars),
    });

    return reply.code(201).send(deployment);
  });
}
