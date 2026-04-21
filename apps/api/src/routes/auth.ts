import type { FastifyInstance } from "fastify";
import { requireUser } from "../lib/auth";
import { getRequiredEnv } from "../lib/env";
import { prisma } from "../lib/prisma";
import { exchangeCodeForToken, getGitHubUser } from "../services/github";

type GitHubCallbackQuery = {
  code?: string;
};

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/auth/github", async (_request, reply) => {
    const clientId = getRequiredEnv("GITHUB_CLIENT_ID");
    const apiBaseUrl = getRequiredEnv("API_BASE_URL").replace(/\/$/, "");

    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", `${apiBaseUrl}/auth/github/callback`);
    url.searchParams.set("scope", "read:user user:email repo admin:repo_hook");

    return reply.redirect(url.toString());
  });

  fastify.get<{ Querystring: GitHubCallbackQuery }>("/auth/github/callback", async (request, reply) => {
    if (!request.query.code) {
      return reply.code(400).send({ error: "Missing GitHub OAuth code" });
    }

    const accessToken = await exchangeCodeForToken(request.query.code);
    const githubUser = await getGitHubUser(accessToken);

    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ githubId: githubUser.id }, { email: githubUser.email }],
      },
    });

    const user = existingUser
      ? await prisma.user.update({
          where: { id: existingUser.id },
          data: {
            githubId: githubUser.id,
            githubToken: accessToken,
            email: githubUser.email,
            avatarUrl: githubUser.avatarUrl,
          },
          select: {
            id: true,
            email: true,
            githubId: true,
            avatarUrl: true,
            createdAt: true,
          },
        })
      : await prisma.user.create({
          data: {
            email: githubUser.email,
            githubId: githubUser.id,
            githubToken: accessToken,
            avatarUrl: githubUser.avatarUrl,
          },
          select: {
            id: true,
            email: true,
            githubId: true,
            avatarUrl: true,
            createdAt: true,
          },
        });

    const token = fastify.jwt.sign(
      {
        sub: user.id,
        email: user.email,
      },
      {
        expiresIn: "7d",
      }
    );

    return reply.send({
      token,
      user,
    });
  });

  fastify.get("/auth/me", async (request, reply) => {
    const authUser = await requireUser(request, reply);
    if (!authUser) {
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: {
        id: true,
        email: true,
        githubId: true,
        avatarUrl: true,
        createdAt: true,
      },
    });

    if (!user) {
      return reply.code(401).send({ error: "User not found" });
    }

    return reply.send(user);
  });

  fastify.post("/auth/logout", async (_request, reply) => {
    return reply.send({ success: true });
  });

  fastify.post<{ Body: { providerToken: string } }>("/auth/sync", async (request, reply) => {
    const authUser = await requireUser(request, reply);
    if (!authUser) return;

    const { providerToken } = request.body;
    if (!providerToken) {
      return reply.code(400).send({ error: "Missing providerToken" });
    }

    await prisma.user.update({
      where: { id: authUser.id },
      data: { githubToken: providerToken },
    });

    return reply.send({ success: true });
  });
}

