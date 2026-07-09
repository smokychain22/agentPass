const FETCH_ERROR =
  "Could not fetch repository ZIP. Check if the repo is public or branch exists.";

const BRANCH_ERROR =
  "Could not fetch this branch. Check if the branch exists or leave branch empty to use default branch.";

export class RepoFetchError extends Error {
  constructor(message = FETCH_ERROR) {
    super(message);
    this.name = "RepoFetchError";
  }
}

const GITHUB_HEADERS = {
  "User-Agent": "RepoDiet/1.0 (+https://github.com/smokychain22/agentPass)",
  Accept: "application/vnd.github+json",
};

function zipUrl(owner: string, repo: string, branch: string): string {
  return `https://github.com/${owner}/${repo}/archive/refs/heads/${encodeURIComponent(branch)}.zip`;
}

async function tryFetch(url: string): Promise<Response> {
  return fetch(url, { headers: GITHUB_HEADERS, redirect: "follow" });
}

export async function fetchDefaultBranch(
  owner: string,
  repo: string
): Promise<string | null> {
  const res = await tryFetch(`https://api.github.com/repos/${owner}/${repo}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { default_branch?: string };
  return data.default_branch ?? null;
}

export async function fetchRepoZip(
  owner: string,
  repo: string,
  branch?: string
): Promise<{ buffer: ArrayBuffer; branch: string }> {
  if (branch) {
    const res = await tryFetch(zipUrl(owner, repo, branch));
    if (res.ok) {
      return { buffer: await res.arrayBuffer(), branch };
    }
    if (res.status === 403) {
      throw new RepoFetchError(
        "Repository appears to be private or access is forbidden."
      );
    }
    throw new RepoFetchError(BRANCH_ERROR);
  }

  const defaultBranch = await fetchDefaultBranch(owner, repo);
  const candidates = [...new Set([defaultBranch, "main", "master"].filter(Boolean))] as string[];

  for (const candidate of candidates) {
    const res = await tryFetch(zipUrl(owner, repo, candidate));
    if (res.ok) {
      return { buffer: await res.arrayBuffer(), branch: candidate };
    }
    if (res.status === 404) continue;
    if (res.status === 403) {
      throw new RepoFetchError(
        "Repository appears to be private or access is forbidden."
      );
    }
  }

  throw new RepoFetchError(FETCH_ERROR);
}
