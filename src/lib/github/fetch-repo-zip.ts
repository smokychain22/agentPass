const FETCH_ERROR =
  "Could not fetch repository ZIP. Check if the repo is public or branch exists.";

export class RepoFetchError extends Error {
  constructor(message = FETCH_ERROR) {
    super(message);
    this.name = "RepoFetchError";
  }
}

function zipUrl(owner: string, repo: string, branch: string): string {
  return `https://github.com/${owner}/${repo}/archive/refs/heads/${encodeURIComponent(branch)}.zip`;
}

async function tryFetch(url: string): Promise<Response> {
  return fetch(url, {
    headers: {
      "User-Agent": "RepoDiet/1.0 (+https://github.com/smokychain22/agentPass)",
      Accept: "application/vnd.github+json",
    },
    redirect: "follow",
  });
}

export async function fetchRepoZip(
  owner: string,
  repo: string,
  branch?: string
): Promise<{ buffer: ArrayBuffer; branch: string }> {
  const candidates = branch
    ? [branch]
    : ["main", "master"];

  if (branch) {
    const res = await tryFetch(zipUrl(owner, repo, branch));
    if (res.ok) {
      return { buffer: await res.arrayBuffer(), branch };
    }
    throw new RepoFetchError(FETCH_ERROR);
  }

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
