import {
	ChangeMessageVisibilityCommand,
	DeleteMessageCommand,
	ReceiveMessageCommand,
	SQSClient,
	type Message,
} from "@aws-sdk/client-sqs";
import {
	DeleteObjectsCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { lookup } from "mime-types";
import { rimraf } from "rimraf";

type LogLevel = "INFO" | "WARN" | "ERROR";

type DeploymentStatus =
	| "QUEUED"
	| "BUILDING"
	| "UPLOADING"
	| "READY"
	| "FAILED"
	| "CANCELLED";

type BuildJob = {
	deploymentId: string;
	projectId: string;
	projectSlug: string;
	repoFullName: string;
	repoUrl: string;
	branch: string;
	commitSha: string;
	commitMessage?: string;
	envVars?: Record<string, string>;
};

type ActiveJobContext = {
	deploymentId: string;
	receiptHandle: string;
};

type DeploymentRow = {
	id: string;
	s3_key?: string | null;
	deployed_url?: string | null;
};

const REGION = process.env.AWS_REGION ?? "ap-south-1";
const QUEUE_URL = process.env.SQS_QUEUE_URL;
const BUCKET = process.env.S3_BUCKET_NAME;
const PLATFORM_DOMAIN = process.env.PLATFORM_DOMAIN ?? "yourplatform.dev";
const BUILD_ROOT = process.env.BUILD_ROOT_DIR ?? join(tmpdir(), "servhub-mini-builds");
const VISIBILITY_TIMEOUT_SECONDS = Number(process.env.SQS_VISIBILITY_TIMEOUT_SECONDS ?? "600");
const WAIT_TIME_SECONDS = Number(process.env.SQS_WAIT_TIME_SECONDS ?? "20");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!QUEUE_URL) {
	throw new Error("Missing required environment variable: SQS_QUEUE_URL");
}

if (!BUCKET) {
	throw new Error("Missing required environment variable: S3_BUCKET_NAME");
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
	throw new Error("Missing required Supabase environment variables");
}

const sqs = new SQSClient({ region: REGION });
const s3 = new S3Client({ region: REGION });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

let shuttingDown = false;
let activeJob: ActiveJobContext | null = null;

function nowIso(): string {
	return new Date().toISOString();
}

function toLogMessage(value: unknown): string {
	if (value instanceof Error) {
		return value.message;
	}

	if (typeof value === "string") {
		return value;
	}

	return JSON.stringify(value);
}

function normalizeEnvVars(envVars: unknown): Record<string, string> {
	if (!envVars || typeof envVars !== "object" || Array.isArray(envVars)) {
		return {};
	}

	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(envVars as Record<string, unknown>)) {
		if (typeof value === "string") {
			result[key] = value;
		} else if (value !== null && value !== undefined) {
			result[key] = String(value);
		}
	}

	return result;
}

function parseBuildJob(body: string): BuildJob {
	const parsed = JSON.parse(body) as Partial<BuildJob>;

	const requiredFields: Array<keyof BuildJob> = [
		"deploymentId",
		"projectId",
		"projectSlug",
		"repoFullName",
		"repoUrl",
		"branch",
		"commitSha",
	];

	for (const field of requiredFields) {
		const value = parsed[field];
		if (!value || typeof value !== "string") {
			throw new Error(`Invalid build job payload: missing ${field}`);
		}
	}

	return {
		deploymentId: parsed.deploymentId!,
		projectId: parsed.projectId!,
		projectSlug: parsed.projectSlug!,
		repoFullName: parsed.repoFullName!,
		repoUrl: parsed.repoUrl!,
		branch: parsed.branch!,
		commitSha: parsed.commitSha!,
		commitMessage: parsed.commitMessage,
		envVars: normalizeEnvVars(parsed.envVars),
	};
}

async function insertBuildLog(deploymentId: string, message: string, level: LogLevel = "INFO"): Promise<void> {
	const trimmed = message.trim();
	if (!trimmed) {
		return;
	}

	const { error } = await supabase.from("build_logs").insert({
		deployment_id: deploymentId,
		message: trimmed.slice(0, 8000),
		level,
	});

	if (error) {
		console.error("Failed to write build log:", error.message);
	}
}

async function updateDeploymentStatus(
	deploymentId: string,
	status: DeploymentStatus,
	extra: Record<string, unknown> = {}
): Promise<void> {
	const { error } = await supabase
		.from("deployments")
		.update({ status, ...extra })
		.eq("id", deploymentId);

	if (error) {
		throw new Error(`Failed to update deployment ${deploymentId}: ${error.message}`);
	}
}

function getNpmCommand(): string {
	return process.platform === "win32" ? "npm.cmd" : "npm";
}

async function runCommand(
	deploymentId: string,
	command: string,
	args: string[],
	options: {
		cwd?: string;
		env?: NodeJS.ProcessEnv;
		stdoutLevel?: LogLevel;
		stderrLevel?: LogLevel;
	} = {}
): Promise<void> {
	await insertBuildLog(deploymentId, `$ ${command} ${args.join(" ")}`);

	await new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env,
			stdio: ["ignore", "pipe", "pipe"],
		});

		const logPromises: Array<Promise<void>> = [];
		let stderrTail = "";

		const streamLines = (
			stream: NodeJS.ReadableStream,
			level: LogLevel,
			onLine?: (line: string) => void
		) => {
			let buffer = "";

			stream.on("data", (chunk) => {
				buffer += chunk.toString();

				const lines = buffer.split(/\r?\n/);
				buffer = lines.pop() ?? "";

				for (const line of lines) {
					const clean = line.trim();
					if (!clean) {
						continue;
					}

					if (onLine) {
						onLine(clean);
					}

					logPromises.push(insertBuildLog(deploymentId, clean, level));
				}
			});

			stream.on("end", () => {
				const clean = buffer.trim();
				if (!clean) {
					return;
				}

				if (onLine) {
					onLine(clean);
				}

				logPromises.push(insertBuildLog(deploymentId, clean, level));
			});
		};

		streamLines(child.stdout, options.stdoutLevel ?? "INFO");
		streamLines(child.stderr, options.stderrLevel ?? "WARN", (line) => {
			stderrTail = `${stderrTail}\n${line}`.trim().slice(-2000);
		});

		child.on("error", (error) => {
			reject(error);
		});

		child.on("close", async (code) => {
			await Promise.allSettled(logPromises);

			if (code === 0) {
				resolve();
				return;
			}

			reject(new Error(`Command failed (${command}) with exit code ${code}. ${stderrTail}`));
		});
	});
}

async function walkDirectory(dirPath: string): Promise<string[]> {
	const entries = await readdir(dirPath, { withFileTypes: true });
	const nested = await Promise.all(
		entries.map(async (entry) => {
			const fullPath = join(dirPath, entry.name);
			if (entry.isDirectory()) {
				return walkDirectory(fullPath);
			}

			return [fullPath];
		})
	);

	return nested.flat();
}

function rewriteStaticPathsForDeployment(content: string, deploymentPathPrefix: string): string {
	let rewritten = content;

	// Keep static assets within the same deployment prefix so CloudFront path-based URLs work.
	rewritten = rewritten.replace(/(["'`])\/assets\//g, `$1${deploymentPathPrefix}/assets/`);
	rewritten = rewritten.replace(/(["'`])\/static\//g, `$1${deploymentPathPrefix}/static/`);
	rewritten = rewritten.replace(/(["'`])\/vite\.svg\b/g, `$1${deploymentPathPrefix}/vite.svg`);
	rewritten = rewritten.replace(/(["'`])\/favicon\.ico\b/g, `$1${deploymentPathPrefix}/favicon.ico`);
	rewritten = rewritten.replace(/url\(\s*\/assets\//g, `url(${deploymentPathPrefix}/assets/`);
	rewritten = rewritten.replace(/url\(\s*\/static\//g, `url(${deploymentPathPrefix}/static/`);
	rewritten = rewritten.replace(/url\(\s*\/vite\.svg\b/g, `url(${deploymentPathPrefix}/vite.svg`);

	return rewritten;
}

function chunkArray<T>(items: T[], size: number): T[][] {
	const chunks: T[][] = [];

	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size));
	}

	return chunks;
}

async function listObjectKeys(prefix: string): Promise<string[]> {
	const keys: string[] = [];
	let continuationToken: string | undefined;

	do {
		const response = await s3.send(
			new ListObjectsV2Command({
				Bucket: BUCKET,
				Prefix: prefix,
				ContinuationToken: continuationToken,
			})
		);

		for (const object of response.Contents ?? []) {
			if (object.Key) {
				keys.push(object.Key);
			}
		}

		continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
	} while (continuationToken);

	return keys;
}

async function deleteObjects(keys: string[]): Promise<void> {
	for (const chunk of chunkArray(keys, 1000)) {
		await s3.send(
			new DeleteObjectsCommand({
				Bucket: BUCKET,
				Delete: {
					Objects: chunk.map((key) => ({ Key: key })),
					Quiet: true,
				},
			})
		);
	}
}

async function cleanupOldDeployments(projectId: string, currentDeploymentId: string): Promise<void> {
	const { data, error } = await supabase
		.from("deployments")
		.select("id,s3_key,deployed_url")
		.eq("project_id", projectId)
		.neq("id", currentDeploymentId);

	if (error) {
		console.error("Failed to fetch old deployments for cleanup:", error.message);
		return;
	}

	for (const row of (data ?? []) as DeploymentRow[]) {
		const oldDeploymentId = row.id;
		if (!oldDeploymentId) {
			continue;
		}

		if (typeof row.s3_key === "string" && row.s3_key.length > 0) {
			try {
				const keys = await listObjectKeys(row.s3_key);
				if (keys.length > 0) {
					await deleteObjects(keys);
					await insertBuildLog(
						currentDeploymentId,
						`Deleted ${keys.length} old artifact(s) from deployment ${oldDeploymentId}`
					);
				}
			} catch (cleanupError) {
				console.error(`Failed deleting artifacts for deployment ${oldDeploymentId}:`, cleanupError);
			}
		}

		const { error: clearError } = await supabase
			.from("deployments")
			.update({ s3_key: null, deployed_url: null })
			.eq("id", oldDeploymentId);

		if (clearError) {
			console.error(`Failed clearing live URL for deployment ${oldDeploymentId}:`, clearError.message);
		}
	}
}

async function uploadDirectory(deploymentId: string, sourceDir: string, s3Prefix: string): Promise<void> {
	const files = await walkDirectory(sourceDir);
	const deploymentPathPrefix = `/${s3Prefix}`;

	for (const filePath of files) {
		const fileKey = `${s3Prefix}/${relative(sourceDir, filePath).replace(/\\/g, "/")}`;
		const contentType = lookup(filePath);
		const lowerCasePath = filePath.toLowerCase();
		const shouldRewrite =
			lowerCasePath.endsWith(".html") ||
			lowerCasePath.endsWith(".js") ||
			lowerCasePath.endsWith(".css");

		let body: Buffer | ReturnType<typeof createReadStream>;
		if (shouldRewrite) {
			const original = await readFile(filePath, "utf8");
			const rewritten = rewriteStaticPathsForDeployment(original, deploymentPathPrefix);
			if (rewritten !== original) {
				await insertBuildLog(deploymentId, `Rewrote asset URLs in ${fileKey} for deployment path prefix`);
			}

			body = Buffer.from(rewritten, "utf8");
		} else {
			body = createReadStream(filePath);
		}

		await s3.send(
			new PutObjectCommand({
				Bucket: BUCKET,
				Key: fileKey,
				Body: body,
				ContentType: typeof contentType === "string" ? contentType : "application/octet-stream",
			})
		);

		await insertBuildLog(deploymentId, `Uploaded ${fileKey}`);
	}
}

function deploymentUrl(projectSlug: string, deploymentId: string): string {
	const normalizedDomain = PLATFORM_DOMAIN.replace(/^https?:\/\//, "").replace(/\/+$/, "");

	if (normalizedDomain.endsWith(".cloudfront.net")) {
		return `https://${normalizedDomain}/deployments/${deploymentId}/index.html`;
	}

	return `https://${projectSlug}.${normalizedDomain}`;
}

async function processBuildMessage(message: Message): Promise<void> {
	if (!message.Body || !message.ReceiptHandle) {
		throw new Error("Received SQS message with missing body or receipt handle");
	}

	const job = parseBuildJob(message.Body);
	const cloneDir = join(BUILD_ROOT, job.deploymentId);

	activeJob = {
		deploymentId: job.deploymentId,
		receiptHandle: message.ReceiptHandle,
	};

	const visibilityTimer = setInterval(() => {
		void sqs.send(
			new ChangeMessageVisibilityCommand({
				QueueUrl: QUEUE_URL,
				ReceiptHandle: message.ReceiptHandle,
				VisibilityTimeout: VISIBILITY_TIMEOUT_SECONDS,
			})
		);
	}, Math.max(60_000, Math.floor(VISIBILITY_TIMEOUT_SECONDS * 500)));

	try {
		await mkdir(BUILD_ROOT, { recursive: true });
		await rimraf(cloneDir);

		await updateDeploymentStatus(job.deploymentId, "BUILDING");
		await insertBuildLog(job.deploymentId, `Starting build for ${job.repoFullName}@${job.commitSha}`);

		await runCommand(job.deploymentId, "git", ["clone", "--depth", "1", job.repoUrl, cloneDir]);
		await runCommand(job.deploymentId, "git", ["-C", cloneDir, "checkout", job.commitSha]);

		await runCommand(job.deploymentId, getNpmCommand(), ["ci"], { cwd: cloneDir });
		await runCommand(job.deploymentId, getNpmCommand(), ["run", "build"], {
			cwd: cloneDir,
			env: {
				...process.env,
				...job.envVars,
				CI: "false",
			},
			stdoutLevel: "INFO",
			stderrLevel: "WARN",
		});

		const buildDir = join(cloneDir, "build");
		const distDir = join(cloneDir, "dist");

		let outputDir = buildDir;
		try {
			await readdir(outputDir);
		} catch {
			outputDir = distDir;
			await readdir(outputDir);
			await insertBuildLog(job.deploymentId, "No build/ directory found; using dist/ output instead", "WARN");
		}

		await updateDeploymentStatus(job.deploymentId, "UPLOADING");
		await insertBuildLog(job.deploymentId, "Uploading build artifacts to S3");

		const s3Key = `deployments/${job.deploymentId}`;
		await uploadDirectory(job.deploymentId, outputDir, s3Key);

		const deployedUrl = deploymentUrl(job.projectSlug, job.deploymentId);
		await updateDeploymentStatus(job.deploymentId, "READY", {
			s3_key: s3Key,
			deployed_url: deployedUrl,
			finished_at: nowIso(),
		});

		await cleanupOldDeployments(job.projectId, job.deploymentId);

		await insertBuildLog(job.deploymentId, `Build complete. Live at ${deployedUrl}`);

		await sqs.send(
			new DeleteMessageCommand({
				QueueUrl: QUEUE_URL,
				ReceiptHandle: message.ReceiptHandle,
			})
		);
	} catch (error) {
		const messageText = toLogMessage(error);
		await insertBuildLog(job.deploymentId, messageText, "ERROR");

		await updateDeploymentStatus(job.deploymentId, "FAILED", {
			finished_at: nowIso(),
		}).catch((statusError) => {
			console.error("Failed to update deployment failure status:", statusError);
		});

		console.error(`Build failed for deployment ${job.deploymentId}:`, error);
	} finally {
		clearInterval(visibilityTimer);
		activeJob = null;
		await rimraf(cloneDir).catch(() => undefined);
	}
}

async function pollQueue(): Promise<void> {
	console.log("Builder worker started. Polling SQS...");

	while (!shuttingDown) {
		try {
			const response = await sqs.send(
				new ReceiveMessageCommand({
					QueueUrl: QUEUE_URL,
					MaxNumberOfMessages: 1,
					WaitTimeSeconds: WAIT_TIME_SECONDS,
					VisibilityTimeout: VISIBILITY_TIMEOUT_SECONDS,
				})
			);

			const message = response.Messages?.[0];
			if (!message) {
				continue;
			}

			await processBuildMessage(message);
		} catch (error) {
			console.error("Queue polling error:", error);
			await new Promise((resolve) => setTimeout(resolve, 5000));
		}
	}
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
	if (shuttingDown) {
		return;
	}

	shuttingDown = true;
	console.warn(`Received ${signal}. Starting graceful shutdown.`);

	if (!activeJob) {
		process.exit(0);
		return;
	}

	await insertBuildLog(
		activeJob.deploymentId,
		`Builder received ${signal}. Marking deployment as CANCELLED for retry.`,
		"WARN"
	);

	await updateDeploymentStatus(activeJob.deploymentId, "CANCELLED", {
		finished_at: nowIso(),
	}).catch((error) => {
		console.error("Failed to mark deployment as CANCELLED:", error);
	});

	process.exit(0);
}

process.on("SIGTERM", () => {
	void shutdown("SIGTERM");
});

process.on("SIGINT", () => {
	void shutdown("SIGINT");
});

void pollQueue();
