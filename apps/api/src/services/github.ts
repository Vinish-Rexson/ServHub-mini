import { getRequiredEnv } from "../lib/env";

type OAuthTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type GitHubProfile = {
  id: number;
  login: string;
  email: string | null;
  avatar_url: string | null;
};

type GitHubEmail = {
  email: string;
  primary: boolean;
  verified: boolean;
};

export type GitHubUser = {
  id: string;
  login: string;
  email: string;
  avatarUrl: string | null;
};

async function githubRequest<T>(
  url: string,
  accessToken: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub request failed (${response.status}): ${text}`);
  }

  return (await response.json()) as T;
}

export async function exchangeCodeForToken(code: string): Promise<string> {
  const clientId = getRequiredEnv("GITHUB_CLIENT_ID");
  const clientSecret = getRequiredEnv("GITHUB_CLIENT_SECRET");

  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  const data = (await response.json()) as OAuthTokenResponse;

  if (!response.ok || !data.access_token) {
    const reason = data.error_description ?? data.error ?? "Unknown OAuth error";
    throw new Error(`GitHub OAuth exchange failed: ${reason}`);
  }

  return data.access_token;
}

export async function getGitHubUser(accessToken: string): Promise<GitHubUser> {
  const profile = await githubRequest<GitHubProfile>("https://api.github.com/user", accessToken);

  let email = profile.email;
  if (!email) {
    const emails = await githubRequest<GitHubEmail[]>("https://api.github.com/user/emails", accessToken);
    const preferred = emails.find((item) => item.primary && item.verified) ?? emails[0];
    email = preferred?.email ?? null;
  }

  if (!email) {
    throw new Error("GitHub account does not expose an email address");
  }

  return {
    id: String(profile.id),
    login: profile.login,
    email,
    avatarUrl: profile.avatar_url,
  };
}

export type GitHubRepo = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  updated_at: string;
  default_branch?: string;
};

export async function getGitHubRepos(accessToken: string): Promise<GitHubRepo[]> {
  // Fetch up to 100 repositories sorted by last updated
  const repos = await githubRequest<GitHubRepo[]>(
    "https://api.github.com/user/repos?sort=updated&per_page=100",
    accessToken
  );
  return repos;
}

export async function registerWebhook(repoFullName: string, accessToken: string): Promise<number> {
  const apiBaseUrl = getRequiredEnv("API_BASE_URL");
  const webhookSecret = getRequiredEnv("GITHUB_WEBHOOK_SECRET");

  const response = await githubRequest<{ id: number }>(
    `https://api.github.com/repos/${repoFullName}/hooks`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        name: "web",
        active: true,
        events: ["push"],
        config: {
          url: `${apiBaseUrl.replace(/\/$/, "")}/webhook/github`,
          content_type: "json",
          secret: webhookSecret,
        },
      }),
    }
  );

  return response.id;
}

export async function removeWebhook(
  repoFullName: string,
  webhookId: number,
  accessToken: string
): Promise<void> {
  await githubRequest<unknown>(`https://api.github.com/repos/${repoFullName}/hooks/${webhookId}`, accessToken, {
    method: "DELETE",
  });
}
