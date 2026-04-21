export function resolveDeploymentUrl(deploymentId: string, deployedUrl: string | null): string | null {
  if (!deployedUrl) {
    return null;
  }

  try {
    const parsed = new URL(deployedUrl);
    const hostname = parsed.hostname.toLowerCase();

    // CloudFront default domains do not support arbitrary wildcard subdomains.
    if (hostname.endsWith(".cloudfront.net")) {
      const labels = hostname.split(".");
      if (labels.length > 3) {
        const baseHost = labels.slice(-3).join(".");
        return `https://${baseHost}/deployments/${deploymentId}/index.html`;
      }
    }

    return deployedUrl;
  } catch {
    return deployedUrl;
  }
}
