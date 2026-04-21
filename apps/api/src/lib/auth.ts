import type { FastifyReply, FastifyRequest } from "fastify";
import { getSupabaseServiceClient } from "../services/supabase";
import { prisma } from "./prisma";

export type AuthenticatedUser = {
  id: string;
  email?: string;
};

export async function requireUser(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<AuthenticatedUser | null> {
  try {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      reply.code(401).send({ error: "Missing or invalid authorization header" });
      return null;
    }

    const token = authHeader.split(" ")[1];
    if (!token) {
      reply.code(401).send({ error: "Unauthorized" });
      return null;
    }

    const supabase = getSupabaseServiceClient();
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      request.log.error({ error }, "Supabase auth.getUser failed");
      reply.code(401).send({ error: "Unauthorized" });
      return null;
    }

    // Upsert the user into the public schema so Prisma foreign keys work
    request.log.info({ authUserId: user.id, authEmail: user.email }, "Upserting user from Supabase Auth");
    
    await prisma.user.upsert({
      where: { id: user.id },
      update: {
        email: user.email || "",
        avatarUrl: user.user_metadata?.avatar_url || null,
        githubId: user.user_metadata?.provider_id || null,
      },
      create: {
        id: user.id,
        email: user.email || "",
        avatarUrl: user.user_metadata?.avatar_url || null,
        githubId: user.user_metadata?.provider_id || null,
      },
    });

    return {
      id: user.id,
      email: user.email,
    };
  } catch (error) {
    console.error("Auth error:", error);
    reply.code(401).send({ error: "Unauthorized" });
    return null;
  }
}
