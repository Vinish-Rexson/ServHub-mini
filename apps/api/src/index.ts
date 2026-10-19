import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import Fastify from "fastify";
import rawBody from "fastify-raw-body";
import { getNumberEnv } from "./lib/env";
import { authRoutes } from "./routes/auth";
import { deploymentRoutes } from "./routes/deployments";
import { projectRoutes } from "./routes/projects";
import { webhookRoutes } from "./routes/webhook";
import { handleProjectProxy } from "./services/proxy";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      sub: string;
      email?: string;
    };
    user: {
      sub: string;
      email?: string;
    };
  }
}

async function buildServer() {
  const app = Fastify({
    logger: true,
  });

  // Handle project subdomain requests (e.g. project-slug.domain.com)
  app.addHook("onRequest", async (req, reply) => {
    const rawHost = (req.headers.host ?? req.hostname).toLowerCase().split(":")[0];
    const apiDomain = (process.env.API_BASE_URL ? new URL(process.env.API_BASE_URL).hostname : "api-servhub.4istudios.in").toLowerCase();

    // If request is not for the API domain and not localhost/IP, serve via project proxy
    if (rawHost !== apiDomain && rawHost !== "localhost" && rawHost !== "127.0.0.1" && !rawHost.match(/^\d+\.\d+\.\d+\.\d+$/)) {
      return handleProjectProxy(req, reply, rawHost);
    }
  });

  app.setNotFoundHandler(async (req, reply) => {
    const rawHost = (req.headers.host ?? req.hostname).toLowerCase().split(":")[0];
    const apiDomain = (process.env.API_BASE_URL ? new URL(process.env.API_BASE_URL).hostname : "api-servhub.4istudios.in").toLowerCase();

    if (rawHost !== apiDomain && rawHost !== "localhost" && rawHost !== "127.0.0.1" && !rawHost.match(/^\d+\.\d+\.\d+\.\d+$/)) {
      return handleProjectProxy(req, reply, rawHost);
    }

    return reply.status(404).send({ error: "Not Found", message: `Route ${req.method}:${req.url} not found` });
  });

  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  await app.register(jwt, {
    secret: process.env.JWT_SECRET ?? "replace_for_dev",
  });

  await app.register(rawBody, {
    field: "rawBody",
    global: false,
    encoding: "utf8",
    runFirst: true,
  });

  app.get("/health", async () => ({ status: "ok" }));

  await app.register(authRoutes);
  await app.register(projectRoutes);
  await app.register(deploymentRoutes);
  await app.register(webhookRoutes);

  return app;
}

async function start() {
  const app = await buildServer();
  const port = getNumberEnv("PORT", 3001);

  await app.listen({
    host: "0.0.0.0",
    port,
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
