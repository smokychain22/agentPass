import { createGitHubAppJwt } from "./jwt";
import type { GitHubInstallationSession, InstallationTokenResult } from "./types";
import { getInstallationOctokit } from "./octokit";

export async function createInstallationAccessToken(
  installationId: number
): Promise<InstallationTokenResult> {
  const appJwt = createGitHubAppJwt();
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to create installation access token (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as { token: string; expires_at: string };
  return {
    token: data.token,
    expiresAt: data.expires_at,
  };
}

export async function fetchInstallationSession(
  installationId: number
): Promise<GitHubInstallationSession> {
  const appJwt = createGitHubAppJwt();
  const res = await fetch(`https://api.github.com/app/installations/${installationId}`, {
    headers: {
      Authorization: `Bearer ${appJwt}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch installation metadata (${res.status}).`);
  }

  const data = (await res.json()) as {
    id: number;
    account?: { login?: string; type?: string };
    created_at?: string;
  };

  return {
    installationId: data.id,
    accountLogin: data.account?.login ?? "unknown",
    accountType: data.account?.type ?? "User",
    connectedAt: data.created_at ?? new Date().toISOString(),
  };
}

export async function installationHasRepoAccess(
  installationId: number,
  owner: string,
  repo: string
): Promise<boolean> {
  try {
    const octokit = await getInstallationOctokit(installationId);
    await octokit.rest.repos.get({ owner, repo });
    return true;
  } catch {
    return false;
  }
}

export async function getInstallationPermissions(installationId: number) {
  const appJwt = createGitHubAppJwt();
  const res = await fetch(`https://api.github.com/app/installations/${installationId}`, {
    headers: {
      Authorization: `Bearer ${appJwt}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!res.ok) return null;

  const data = (await res.json()) as {
    permissions?: {
      contents?: string;
      pull_requests?: string;
      metadata?: string;
    };
  };

  return {
    contents: data.permissions?.contents ?? "unknown",
    pullRequests: data.permissions?.pull_requests ?? "unknown",
    metadata: data.permissions?.metadata ?? "unknown",
  };
}
