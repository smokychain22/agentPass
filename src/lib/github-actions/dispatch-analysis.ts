/**
 * Dispatch RepoDiet analysis to ephemeral GitHub Actions workers.
 * Secrets never appear in workflow inputs — only opaque identifiers.
 */

import { nanoid } from "nanoid";

export const ANALYSIS_WORKFLOW_FILE = "repodiet-analysis-worker.yml";
export const ACTIONS_WORKER_ID = "github-actions/ubuntu-latest";

export interface DispatchWorkflowInput {
  jobId: string;
  requestId: string;
  dispatchNonce: string;
  environment: "production" | "preview" | "development";
  /** Public API origin only — never includes secrets. */
  apiBaseUrl: string;
}

export interface DispatchWorkflowResult {
  ok: true;
  workflowRunId?: string;
  workflowRunUrl?: string;
  dispatchedAt: string;
  owner: string;
  repo: string;
  ref: string;
}

export interface DispatchWorkflowFailure {
  ok: false;
  code:
    | "DISPATCH_TOKEN_MISSING"
    | "DISPATCH_TOKEN_INVALID"
    | "DISPATCH_FAILED"
    | "WORKFLOW_DISABLED"
    | "REPO_CONFIG_MISSING";
  message: string;
  retryable: boolean;
}

function actionsRepo(): { owner: string; repo: string } | null {
  const full =
    process.env.REPODIET_ACTIONS_REPO?.trim() ||
    process.env.GITHUB_REPOSITORY?.trim() ||
    "smokychain22/agentPass";
  const [owner, repo] = full.split("/");
  if (!owner || !repo) return null;
  return { owner, repo };
}

function dispatchToken(): string | undefined {
  return process.env.REPODIET_ACTIONS_DISPATCH_TOKEN?.trim() || undefined;
}

function workflowRef(): string {
  return (
    process.env.REPODIET_ACTIONS_WORKFLOW_REF?.trim() ||
    process.env.VERCEL_GIT_COMMIT_REF?.trim() ||
    "main"
  );
}

export function isActionsDispatcherConfigured(): boolean {
  return Boolean(dispatchToken() && actionsRepo());
}

/**
 * Trigger workflow_dispatch. GitHub returns 204; we then resolve the newest matching run.
 */
export async function dispatchAnalysisWorkflow(
  input: DispatchWorkflowInput
): Promise<DispatchWorkflowResult | DispatchWorkflowFailure> {
  const token = dispatchToken();
  if (!token) {
    return {
      ok: false,
      code: "DISPATCH_TOKEN_MISSING",
      message:
        "REPODIET_ACTIONS_DISPATCH_TOKEN is not configured. Cannot start GitHub Actions analysis worker.",
      retryable: false,
    };
  }
  const repoInfo = actionsRepo();
  if (!repoInfo) {
    return {
      ok: false,
      code: "REPO_CONFIG_MISSING",
      message: "REPODIET_ACTIONS_REPO is invalid.",
      retryable: false,
    };
  }

  const ref = workflowRef();
  const url = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/actions/workflows/${ANALYSIS_WORKFLOW_FILE}/dispatches`;
  const dispatchedAt = new Date().toISOString();

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ref,
        inputs: {
          jobId: input.jobId,
          requestId: input.requestId,
          dispatchNonce: input.dispatchNonce,
          environment: input.environment,
          apiBaseUrl: input.apiBaseUrl,
        },
      }),
    });
  } catch (err) {
    return {
      ok: false,
      code: "DISPATCH_FAILED",
      message: err instanceof Error ? err.message : "GitHub dispatch network failure.",
      retryable: true,
    };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      code: "DISPATCH_TOKEN_INVALID",
      message: "GitHub rejected the Actions dispatch token.",
      retryable: false,
    };
  }
  if (response.status === 404) {
    return {
      ok: false,
      code: "WORKFLOW_DISABLED",
      message: "Analysis workflow not found or Actions disabled for this repository.",
      retryable: false,
    };
  }
  if (response.status !== 204 && !response.ok) {
    const text = await response.text().catch(() => "");
    return {
      ok: false,
      code: "DISPATCH_FAILED",
      message: `GitHub workflow_dispatch failed (${response.status}): ${text.slice(0, 200)}`,
      retryable: response.status >= 500,
    };
  }

  const resolved = await resolveWorkflowRun({
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    token,
    jobId: input.jobId,
    afterIso: dispatchedAt,
  });

  return {
    ok: true,
    workflowRunId: resolved?.id,
    workflowRunUrl: resolved?.html_url,
    dispatchedAt,
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    ref,
  };
}

async function resolveWorkflowRun(input: {
  owner: string;
  repo: string;
  token: string;
  jobId: string;
  afterIso: string;
}): Promise<{ id: string; html_url: string } | null> {
  // workflow_dispatch is async; poll briefly for the new run.
  for (let attempt = 0; attempt < 6; attempt++) {
    await new Promise((r) => setTimeout(r, 800 + attempt * 200));
    const listUrl = `https://api.github.com/repos/${input.owner}/${input.repo}/actions/workflows/${ANALYSIS_WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=10`;
    const res = await fetch(listUrl, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${input.token}`,
        "x-github-api-version": "2022-11-28",
      },
    });
    if (!res.ok) continue;
    const data = (await res.json()) as {
      workflow_runs?: Array<{
        id: number;
        html_url: string;
        created_at: string;
        name?: string;
        display_title?: string;
        head_sha?: string;
      }>;
    };
    const after = Date.parse(input.afterIso) - 5_000;
    const match = (data.workflow_runs ?? []).find((run) => {
      const created = Date.parse(run.created_at);
      if (created < after) return false;
      const title = `${run.name ?? ""} ${run.display_title ?? ""}`;
      return title.includes(input.jobId) || created >= Date.parse(input.afterIso) - 2_000;
    });
    if (match) {
      return { id: String(match.id), html_url: match.html_url };
    }
  }
  return null;
}

export function createCorrelationId(): string {
  return nanoid(10);
}
