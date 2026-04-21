import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { getRequiredEnv } from "../lib/env";

const sqs = new SQSClient({
  region: process.env.AWS_REGION ?? "ap-south-1",
});

export type BuildJob = {
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

export async function enqueueBuild(job: BuildJob): Promise<void> {
  const queueUrl = getRequiredEnv("SQS_QUEUE_URL");

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(job),
    })
  );
}
