import { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { requireUser } from "../lib/auth";
import { prisma } from "../lib/prisma";
import { registerWebhook, removeWebhook } from "../services/github";

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

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
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

    await prisma.project.delete({
      where: { id: project.id },
    });

    return reply.code(204).send();
  });
}
