import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { FastifyReply, FastifyRequest } from "fastify";
import path from "node:path";
import { Readable } from "node:stream";
import { prisma } from "../lib/prisma";

const REGION = process.env.AWS_REGION ?? "ap-south-1";
const BUCKET = process.env.S3_BUCKET_NAME ?? "servhub-mini-deployments";

const s3 = new S3Client({ region: REGION });

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

function getMimeType(filePath: string): string {
  const ext = path.posix.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

export async function handleProjectProxy(req: FastifyRequest, reply: FastifyReply, host: string) {
  // Extract slug from hostname (e.g. "react-boilerplate-ow3hiu.4istudios.in" -> "react-boilerplate-ow3hiu")
  const slug = host.split(".")[0];
  if (!slug) {
    return reply.status(404).type("text/html").send("<h1>404 - Not Found</h1>");
  }

  try {
    const project = await prisma.project.findUnique({
      where: { slug },
      include: {
        deployments: {
          where: { status: "READY" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!project || project.deployments.length === 0 || !project.deployments[0].s3Key) {
      return reply.status(404).type("text/html").send(`
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Deployment Not Found - ServHub</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                background-color: #0b0f19;
                color: #e2e8f0;
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                margin: 0;
              }
              .card {
                background: #1e293b;
                border: 1px solid #334155;
                border-radius: 12px;
                padding: 2.5rem;
                max-width: 480px;
                text-align: center;
                box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
              }
              h1 { font-size: 1.5rem; margin-top: 0; color: #38bdf8; }
              p { color: #94a3b8; line-height: 1.6; font-size: 0.95rem; }
              code { background: #0f172a; padding: 0.2rem 0.4rem; border-radius: 4px; color: #f43f5e; font-size: 0.9em; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>Deployment Not Found</h1>
              <p>No active deployment exists for <code>${slug}</code>. If you just triggered a build, please wait a moment and refresh.</p>
            </div>
          </body>
        </html>
      `);
    }

    const s3Key = project.deployments[0].s3Key;
    let cleanPath = req.url.split("?")[0];
    if (cleanPath === "/" || !cleanPath) {
      cleanPath = "/index.html";
    }

    // Normalize to prevent directory traversal
    let normalized = path.posix.normalize(cleanPath).replace(/^(\.\.[\/\\])+/, "");

    // If the path already contains the s3Key prefix (e.g. /deployments/{id}/assets/...), strip it
    if (normalized.startsWith(`/${s3Key}`)) {
      normalized = normalized.slice(`/${s3Key}`.length);
    } else if (normalized.startsWith(s3Key)) {
      normalized = normalized.slice(s3Key.length);
    }

    if (!normalized || normalized === "/") {
      normalized = "/index.html";
    }

    const requestedKey = `${s3Key}${normalized.startsWith("/") ? "" : "/"}${normalized}`;

    try {
      const response = await s3.send(
        new GetObjectCommand({
          Bucket: BUCKET,
          Key: requestedKey,
        })
      );

      return sendS3Response(response, normalized, reply);
    } catch {
      // If file not found and path has no file extension, fallback to index.html for SPA (React Router)
      const hasExtension = path.posix.extname(normalized) !== "";
      if (!hasExtension) {
        try {
          const fallbackKey = `${s3Key}/index.html`;
          const fallbackResponse = await s3.send(
            new GetObjectCommand({
              Bucket: BUCKET,
              Key: fallbackKey,
            })
          );
          return sendS3Response(fallbackResponse, "/index.html", reply);
        } catch {
          return reply.status(404).type("text/html").send("<h1>404 - Not Found</h1>");
        }
      }

      return reply.status(404).type("text/plain").send("404 File Not Found");
    }
  } catch (error) {
    req.log.error({ err: error, host, url: req.url }, "Error proxying project deployment from S3");
    return reply.status(500).type("text/html").send("<h1>500 - Internal Server Error</h1>");
  }
}

function sendS3Response(response: any, filePath: string, reply: FastifyReply) {
  const mimeType =
    response.ContentType &&
    response.ContentType !== "binary/octet-stream" &&
    response.ContentType !== "application/octet-stream"
      ? response.ContentType
      : getMimeType(filePath);

  reply.header("Content-Type", mimeType);

  if (response.ContentLength) {
    reply.header("Content-Length", response.ContentLength);
  }

  if (filePath.includes("/assets/") || filePath.match(/\.[a-f0-9]{8,}\./)) {
    reply.header("Cache-Control", "public, max-age=31536000, immutable");
  } else {
    reply.header("Cache-Control", "public, max-age=60, must-revalidate");
  }

  if (response.ETag) {
    reply.header("ETag", response.ETag);
  }

  return reply.send(response.Body as Readable);
}
