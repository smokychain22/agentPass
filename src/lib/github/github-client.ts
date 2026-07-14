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
    const entry = await this.getFileEntry(owner, repo, path, branch);
    return entry?.sha ?? null;
  }

  async getFileContent(
    owner: string,
    repo: string,
    path: string,
    branch: string
  ): Promise<string | null> {
    const entry = await this.getFileEntry(owner, repo, path, branch);
    if (!entry?.content) return null;
    return Buffer.from(entry.content.replace(/\n/g, ""), "base64").toString("utf8");
  }

  private async getFileEntry(
    owner: string,
    repo: string,
    filePath: string,
    branch: string
  ): Promise<{ sha?: string; content?: string } | null> {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${filePath
        .split("/")
        .map(encodeURIComponent)
        .join("/")}?ref=${encodeURIComponent(branch)}`,
      { headers: this.headers() }
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new ToolExecutionError(
        "INTERNAL_ERROR",
        `Failed to read file metadata for ${filePath}.`,
        502
      );
    }
    return (await res.json()) as { sha?: string; content?: string };
  }

  async listBranchesWithPrefix(owner: string, repo: string, prefix: string): Promise<string[]> {
    const names: string[] = [];
    for (let page = 1; page <= 5; page += 1) {
      const batch = await this.request<Array<{ name: string }>>(
        `/repos/${owner}/${repo}/branches?per_page=100&page=${page}`
      );
      if (!batch.length) break;
      for (const branch of batch) {
        if (branch.name.startsWith(prefix)) names.push(branch.name);
      }
      if (batch.length < 100) break;
    }
    return names;
  }

  async listOpenPullRequestsForHeadPrefix(
    owner: string,
    repo: string,
    headPrefix: string
  ): Promise<Array<{ number: number; url: string; head: string }>> {
    const pulls = await this.request<
      Array<{ number: number; html_url: string; head: { ref: string; label: string } }>
    >(`/repos/${owner}/${repo}/pulls?state=open&per_page=100`);
    return pulls
      .filter((pr) => pr.head.ref.startsWith(headPrefix.replace(/\/$/, "")))
      .map((pr) => ({ number: pr.number, url: pr.html_url, head: pr.head.ref }));
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

  async getPullRequest(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<{
    number: number;
    url: string;
    headSha: string;
    baseSha: string;
    headRef: string;
    baseRef: string;
    state: string;
  }> {
    const pr = await this.request<{
      number: number;
      html_url: string;
      state: string;
      head: { sha: string; ref: string };
      base: { sha: string; ref: string };
    }>(`/repos/${owner}/${repo}/pulls/${prNumber}`);
    return {
      number: pr.number,
      url: pr.html_url,
      headSha: pr.head.sha,
      baseSha: pr.base.sha,
      headRef: pr.head.ref,
      baseRef: pr.base.ref,
      state: pr.state,
    };
  }

  async listCommitCheckRuns(
    owner: string,
    repo: string,
    ref: string
  ): Promise<
    Array<{
      id: number;
      name: string;
      status: string;
      conclusion: string | null;
      details_url?: string;
      started_at?: string;
      completed_at?: string;
      external_id?: string;
      output?: { title?: string; summary?: string; text?: string };
      app?: { slug?: string; name?: string };
    }>
  > {
    const data = await this.request<{
      check_runs: Array<{
        id: number;
        name: string;
        status: string;
        conclusion: string | null;
        details_url?: string;
        started_at?: string;
        completed_at?: string;
        external_id?: string;
        output?: { title?: string; summary?: string; text?: string };
        app?: { slug?: string; name?: string };
      }>;
    }>(`/repos/${owner}/${repo}/commits/${ref}/check-runs?per_page=100`);
    return data.check_runs ?? [];
  }

  async getBranchRequiredCheckContexts(
    owner: string,
    repo: string,
    branch: string
  ): Promise<string[]> {
    try {
      const protection = await this.request<{
        required_status_checks?: { contexts?: string[]; checks?: Array<{ context: string }> };
      }>(
        `/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}/protection`,
        { expectedStatuses: [200] }
      );
      const fromContexts = protection.required_status_checks?.contexts ?? [];
      const fromChecks =
        protection.required_status_checks?.checks?.map((entry) => entry.context) ?? [];
      return [...new Set([...fromContexts, ...fromChecks])];
    } catch {
      return [];
    }
  }

  async listWorkflowRunsForCommit(
    owner: string,
    repo: string,
    headSha: string
  ): Promise<
    Array<{
      id: number;
      name: string;
      status: string;
      conclusion: string | null;
      html_url?: string;
      created_at?: string;
      updated_at?: string;
    }>
  > {
    const data = await this.request<{
      workflow_runs: Array<{
        id: number;
        name: string;
        status: string;
        conclusion: string | null;
        html_url?: string;
        created_at?: string;
        updated_at?: string;
      }>;
    }>(`/repos/${owner}/${repo}/actions/runs?head_sha=${headSha}&per_page=20`);
    return data.workflow_runs ?? [];
  }

  async listWorkflowRunJobs(
    owner: string,
    repo: string,
    runId: number
  ): Promise<
    Array<{
      id: number;
      name: string;
      status: string;
      conclusion: string | null;
      html_url?: string;
      started_at?: string;
      completed_at?: string;
      steps?: Array<{
        name: string;
        status: string;
        conclusion: string | null;
        number: number;
      }>;
    }>
  > {
    const data = await this.request<{
      jobs: Array<{
        id: number;
        name: string;
        status: string;
        conclusion: string | null;
        html_url?: string;
        started_at?: string;
        completed_at?: string;
        steps?: Array<{
          name: string;
          status: string;
          conclusion: string | null;
          number: number;
        }>;
      }>;
    }>(`/repos/${owner}/${repo}/actions/runs/${runId}/jobs?per_page=100`);
    return data.jobs ?? [];
  }

  async downloadWorkflowJobLog(
    owner: string,
    repo: string,
    jobId: number
  ): Promise<string | undefined> {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/jobs/${jobId}/logs`,
      { headers: this.headers(), redirect: "follow" }
    );
    if (!res.ok) return undefined;
    const text = await res.text();
    return text;
  }

  async rerunWorkflowRun(owner: string, repo: string, runId: number): Promise<boolean> {
    try {
      await this.request(`/repos/${owner}/${repo}/actions/runs/${runId}/rerun`, {
        method: "POST",
        expectedStatuses: [201],
      });
      return true;
    } catch {
      return false;
    }
  }

  async rerunFailedWorkflowRun(owner: string, repo: string, runId: number): Promise<boolean> {
    try {
      await this.request(`/repos/${owner}/${repo}/actions/runs/${runId}/rerun-failed-jobs`, {
        method: "POST",
        expectedStatuses: [201],
      });
      return true;
    } catch {
      return false;
    }
  }

  async rerequestCheckSuite(owner: string, repo: string, checkSuiteId: number): Promise<boolean> {
    try {
      await this.request(`/repos/${owner}/${repo}/check-suites/${checkSuiteId}/rerequest`, {
        method: "POST",
        expectedStatuses: [201],
      });
      return true;
    } catch {
      return false;
    }
  }
}
