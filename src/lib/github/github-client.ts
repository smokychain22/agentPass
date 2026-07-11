import { ToolExecutionError } from "@/lib/a2mcp/errors";

const USER_AGENT = "RepoDiet-Operator/1.0 (+https://github.com/smokychain22/agentPass)";

export interface GitHubRepoMeta {
  owner: string;
  name: string;
  defaultBranch: string;
}

export class GitHubClient {
  constructor(private readonly token: string) {}

  private headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": USER_AGENT,
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  private async request<T>(
    path: string,
    init?: RequestInit & { expectedStatuses?: number[] }
  ): Promise<T> {
    const res = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: { ...this.headers(), ...(init?.headers ?? {}) },
    });

    const expected = init?.expectedStatuses ?? [200, 201];
    if (!expected.includes(res.status)) {
      const text = await res.text().catch(() => "");
      if (res.status === 401 || res.status === 403) {
        throw new ToolExecutionError(
          "GITHUB_PERMISSION_DENIED",
          "GitHub token lacks permission for this repository or action.",
          403
        );
      }
      if (res.status === 404) {
        throw new ToolExecutionError(
          "REPO_NOT_FOUND",
          "Repository, branch, or file was not found on GitHub.",
          404
        );
      }
      throw new ToolExecutionError(
        "INTERNAL_ERROR",
        `GitHub API error (${res.status}): ${text.slice(0, 200)}`,
        502
      );
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  async getRepo(owner: string, repo: string): Promise<GitHubRepoMeta> {
    const data = await this.request<{ default_branch: string }>(
      `/repos/${owner}/${repo}`
    );
    return { owner, name: repo, defaultBranch: data.default_branch };
  }

  async getBranchSha(owner: string, repo: string, branch: string): Promise<string> {
    try {
      const data = await this.request<{ object: { sha: string } }>(
        `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`
      );
      return data.object.sha;
    } catch (err) {
      if (err instanceof ToolExecutionError && err.code === "REPO_NOT_FOUND") {
        throw new ToolExecutionError(
          "BRANCH_NOT_FOUND",
          `Branch "${branch}" was not found on GitHub.`,
          404
        );
      }
      throw err;
    }
  }

  async createBranch(
    owner: string,
    repo: string,
    branchName: string,
    fromSha: string
  ): Promise<void> {
    await this.request(
      `/repos/${owner}/${repo}/git/refs`,
      {
        method: "POST",
        body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: fromSha }),
        expectedStatuses: [201],
      }
    );
  }

  async getFileSha(
    owner: string,
    repo: string,
    path: string,
    branch: string
  ): Promise<string | null> {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${encodeURIComponent(branch)}`,
      { headers: this.headers() }
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new ToolExecutionError(
        "INTERNAL_ERROR",
        `Failed to read file metadata for ${path}.`,
        502
      );
    }
    const data = (await res.json()) as { sha?: string };
    return data.sha ?? null;
  }

  async deleteFile(
    owner: string,
    repo: string,
    path: string,
    branch: string,
    message: string
  ): Promise<boolean> {
    const sha = await this.getFileSha(owner, repo, path, branch);
    if (!sha) return false;

    await this.request(
      `/repos/${owner}/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}`,
      {
        method: "DELETE",
        body: JSON.stringify({ message, sha, branch }),
        expectedStatuses: [200],
      }
    );
    return true;
  }

  async upsertFile(
    owner: string,
    repo: string,
    path: string,
    branch: string,
    content: string,
    message: string
  ): Promise<void> {
    const sha = await this.getFileSha(owner, repo, path, branch);
    const body: Record<string, string> = {
      message,
      content: Buffer.from(content, "utf8").toString("base64"),
      branch,
    };
    if (sha) body.sha = sha;

    await this.request(
      `/repos/${owner}/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}`,
      {
        method: "PUT",
        body: JSON.stringify(body),
        expectedStatuses: [200, 201],
      }
    );
  }

  async createPullRequest(
    owner: string,
    repo: string,
    title: string,
    head: string,
    base: string,
    body: string
  ): Promise<{ url: string; number: number }> {
    try {
      const pr = await this.request<{ html_url: string; number: number }>(
        `/repos/${owner}/${repo}/pulls`,
        {
          method: "POST",
          body: JSON.stringify({ title, head, base, body }),
          expectedStatuses: [201],
        }
      );
      return { url: pr.html_url, number: pr.number };
    } catch (err) {
      if (err instanceof ToolExecutionError) {
        throw new ToolExecutionError(
          "PR_CREATION_FAILED",
          err.message,
          err.status
        );
      }
      throw new ToolExecutionError(
        "PR_CREATION_FAILED",
        "Failed to open GitHub pull request.",
        502
      );
    }
  }
}
