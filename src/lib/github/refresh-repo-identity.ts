import { parseGitHubUrl } from "@/lib/github/parse-github-url";
import type { FindingsPayload } from "@/lib/findings/types";

const GITHUB_HEADERS = {
  "User-Agent": "RepoDiet/1.0 (+https://github.com/smokychain22/agentPass)",
  Accept: "application/vnd.github+json",
};

export interface GitHubRepositoryIdentity {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
}

export async function fetchGitHubRepositoryIdentity(
  owner: string,
  name: string
): Promise<GitHubRepositoryIdentity | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
      headers: GITHUB_HEADERS,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      id?: number;
      name?: string;
      full_name?: string;
      default_branch?: string;
      owner?: { login?: string };
    };
    if (!data.id || !data.name || !data.owner?.login) return null;
    return {
      id: data.id,
      owner: data.owner.login,
      name: data.name,
      fullName: data.full_name ?? `${data.owner.login}/${data.name}`,
      defaultBranch: data.default_branch ?? "main",
    };
  } catch {
    return null;
  }
}

export async function refreshRepositoryIdentityFromUrl(
  repoUrl: string,
  branch?: string
): Promise<GitHubRepositoryIdentity | null> {
  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed) return null;
  const identity = await fetchGitHubRepositoryIdentity(parsed.owner, parsed.repo);
  if (!identity) return null;
  return {
    ...identity,
    defaultBranch: branch?.trim() || identity.defaultBranch,
  };
}

/** Refresh owner/name from GitHub repository ID before scan or cleanup execution. */
export function applyRepositoryIdentity<T extends { repo: FindingsPayload["repo"] }>(
  payload: T,
  identity: GitHubRepositoryIdentity
): T {
  const previousOwner = payload.repo.owner;
  const previousName = payload.repo.name;
  const transferred =
    previousOwner !== identity.owner ||
    previousName !== identity.name;

  return {
    ...payload,
    repo: {
      ...payload.repo,
      owner: identity.owner,
      name: identity.name,
      branch: payload.repo.branch || identity.defaultBranch,
      url: `https://github.com/${identity.owner}/${identity.name}`,
      githubRepositoryId: identity.id,
      previousOwner: transferred ? previousOwner : payload.repo.previousOwner,
      previousName: transferred ? previousName : payload.repo.previousName,
    },
  };
}
