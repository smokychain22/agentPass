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

const ALLOWED_HOSTS = new Set(["github.com", "codeload.github.com", "api.github.com"]);

function assertAllowedUrl(url: string): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new RepoFetchError("Only HTTPS GitHub URLs are allowed.");
  }
  const host = parsed.hostname.replace(/^www\./, "");
  if (!ALLOWED_HOSTS.has(host)) {
    throw new RepoFetchError("Only github.com repository URLs are supported.");
  }
  if (parsed.username || parsed.password) {
    throw new RepoFetchError("Credentials in repository URLs are not allowed.");
  }
  return parsed;
}

function zipUrl(owner: string, repo: string, branch: string): string {
  return `https://github.com/${owner}/${repo}/archive/refs/heads/${encodeURIComponent(branch)}.zip`;
}

async function tryFetch(url: string, redirectCount = 0): Promise<Response> {
  if (redirectCount > 5) {
    throw new RepoFetchError("Too many redirects while fetching repository.");
  }
  assertAllowedUrl(url);
  const res = await fetch(url, {
    headers: GITHUB_HEADERS,
    redirect: "manual",
  });

  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location");
    if (!location) throw new RepoFetchError(FETCH_ERROR);
    const nextUrl = new URL(location, url).toString();
    return tryFetch(nextUrl, redirectCount + 1);
  }

  return res;
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

export async function fetchBranchCommitSha(
  owner: string,
  repo: string,
  branch: string
): Promise<string | null> {
  try {
    const res = await tryFetch(
      `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { object?: { sha?: string } };
    return data.object?.sha ?? null;
  } catch {
    return null;
  }
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

export async function isPublicGitHubRepository(owner: string, repo: string): Promise<boolean> {
  try {
    const res = await tryFetch(`https://api.github.com/repos/${owner}/${repo}`);
    if (!res.ok) return false;
    const data = (await res.json()) as { private?: boolean };
    return data.private === false;
  } catch {
    return false;
  }
}

/** True when path exists in the git tree at ref (commit SHA or branch). */
export async function gitPathExistsAtRef(
  owner: string,
  repo: string,
  ref: string,
  filePath: string
): Promise<boolean> {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  try {
    const res = await tryFetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${normalized}?ref=${encodeURIComponent(ref)}`
    );
    return res.ok;
  } catch {
    return false;
  }
}
