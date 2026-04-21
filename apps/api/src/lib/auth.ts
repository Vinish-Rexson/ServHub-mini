import type { FastifyReply, FastifyRequest } from "fastify";

type JwtPayload = {
  sub: string;
  email?: string;
};

export type AuthenticatedUser = {
  id: string;
  email?: string;
};

export async function requireUser(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<AuthenticatedUser | null> {
  try {
    const payload = await request.jwtVerify<JwtPayload>();
    if (!payload.sub) {
      reply.code(401).send({ error: "Unauthorized" });
      return null;
    }

    return {
      id: payload.sub,
      email: payload.email,
    };
  } catch {
    reply.code(401).send({ error: "Unauthorized" });
    return null;
  }
}
