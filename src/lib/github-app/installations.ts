import { createGitHubAppJwt } from "./jwt";
import type { GitHubInstallationSession, InstallationTokenResult } from "./types";
import { getInstallationOctokit } from "./octokit";
import { repositoryFullNameInList } from "./repository-match";

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

export async function getInstallationDetails(installationId: number) {
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
    id: number;
    suspended_at?: string | null;
    repository_selection?: string;
    permissions?: {
      contents?: string;
      pull_requests?: string;
      metadata?: string;
    };
    account?: { login?: string; type?: string };
  };

  return {
    installationId: data.id,
    suspendedAt: data.suspended_at ?? null,
    repositorySelection: data.repository_selection ?? "all",
    accountLogin: data.account?.login ?? "unknown",
    accountType: data.account?.type ?? "User",
    permissions: {
      contents: data.permissions?.contents ?? "unknown",
      pullRequests: data.permissions?.pull_requests ?? "unknown",
      metadata: data.permissions?.metadata ?? "unknown",
    },
  };
}

export async function getInstallationPermissions(installationId: number) {
  const details = await getInstallationDetails(installationId);
  return details?.permissions ?? null;
}

export async function listInstallationAccessibleRepos(
  installationId: number
): Promise<string[]> {
  const fromInstallation = await listInstallationAccessibleReposWithInstallationAuth(
    installationId
  );
  if (fromInstallation.length > 0) return fromInstallation;

  return listInstallationAccessibleReposWithAppJwt(installationId);
}

async function listInstallationAccessibleReposWithInstallationAuth(
  installationId: number
): Promise<string[]> {
  try {
    const octokit = await getInstallationOctokit(installationId);
    const repos = await octokit.paginate(octokit.rest.apps.listReposAccessibleToInstallation, {
      per_page: 100,
    });
    return repos
      .map((entry) => {
        if (entry.full_name) return entry.full_name;
        if (entry.owner?.login && entry.name) {
          return `${entry.owner.login}/${entry.name}`;
        }
        return "";
      })
      .filter(Boolean);
  } catch (err) {
    console.warn("[github-installations] installation repo list failed", {
      installationIdLast4: String(installationId).slice(-4),
      error: err instanceof Error ? err.message : "unknown",
    });
    return [];
  }
}

async function listInstallationAccessibleReposWithAppJwt(
  installationId: number
): Promise<string[]> {
  try {
    const appJwt = createGitHubAppJwt();
    const repos: string[] = [];
    let page = 1;

    while (page <= 10) {
      const res = await fetch(
        `https://api.github.com/app/installations/${installationId}/repositories?per_page=100&page=${page}`,
        {
          headers: {
            Authorization: `Bearer ${appJwt}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        }
      );

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.warn("[github-installations] app JWT repo list failed", {
          installationIdLast4: String(installationId).slice(-4),
          status: res.status,
          body: text.slice(0, 200),
        });
        break;
      }

      const data = (await res.json()) as {
        repositories?: Array<{ full_name?: string; owner?: { login?: string }; name?: string }>;
        total_count?: number;
      };

      const batch =
        data.repositories?.map((entry) => {
          if (entry.full_name) return entry.full_name;
          if (entry.owner?.login && entry.name) {
            return `${entry.owner.login}/${entry.name}`;
          }
          return "";
        }) ?? [];

      repos.push(...batch.filter(Boolean));

      if (batch.length < 100) break;
      page += 1;
    }

    return repos;
  } catch (err) {
    console.warn("[github-installations] app JWT repo list error", {
      installationIdLast4: String(installationId).slice(-4),
      error: err instanceof Error ? err.message : "unknown",
    });
    return [];
  }
}

export async function installationIncludesRepository(
  installationId: number,
  owner: string,
  repo: string
): Promise<boolean> {
  if (await installationHasRepoAccess(installationId, owner, repo)) {
    return true;
  }
  const repos = await listInstallationAccessibleRepos(installationId);
  return repositoryFullNameInList(repos, owner, repo);
}

export async function installationIncludesRepositoryWithRetry(
  installationId: number,
  owner: string,
  repo: string,
  options?: { attempts?: number; delayMs?: number }
): Promise<{ granted: boolean; accessibleRepos: string[] }> {
  const attempts = options?.attempts ?? 6;
  const delayMs = options?.delayMs ?? 2000;
  let accessibleRepos: string[] = [];

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const hasDirect = await installationHasRepoAccess(installationId, owner, repo);
    if (hasDirect) {
      return { granted: true, accessibleRepos };
    }

    accessibleRepos = await listInstallationAccessibleRepos(installationId);
    if (repositoryFullNameInList(accessibleRepos, owner, repo)) {
      return { granted: true, accessibleRepos };
    }

    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return { granted: false, accessibleRepos };
}
