const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('--- Cleaning Up Supabase Database ---');

  const projects = await prisma.project.findMany({
    include: {
      user: true,
      deployments: true,
    },
  });

  console.log(`Found ${projects.length} project(s) to remove.`);

  for (const p of projects) {
    if (p.webhookId && p.user?.githubToken) {
      console.log(`Attempting to remove GitHub webhook ${p.webhookId} from ${p.repoFullName}...`);
      try {
        const res = await fetch(`https://api.github.com/repos/${p.repoFullName}/hooks/${p.webhookId}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${p.user.githubToken}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        });
        if (res.ok || res.status === 404) {
          console.log(`  ✓ Webhook ${p.webhookId} removed from GitHub.`);
        } else {
          console.log(`  ⚠ GitHub returned ${res.status} when deleting webhook.`);
        }
      } catch (err) {
        console.log(`  ⚠ Could not contact GitHub to delete webhook: ${err.message}`);
      }
    }
  }

  // Delete all deployments & build logs (cascaded by project deletion, but explicit for safety)
  const delLogs = await prisma.buildLog.deleteMany({});
  console.log(`Deleted ${delLogs.count} build log(s).`);

  const delDeps = await prisma.deployment.deleteMany({});
  console.log(`Deleted ${delDeps.count} deployment(s).`);

  const delProjects = await prisma.project.deleteMany({});
  console.log(`Deleted ${delProjects.count} project(s).`);

  console.log('--- Database Cleanup Complete ---');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
