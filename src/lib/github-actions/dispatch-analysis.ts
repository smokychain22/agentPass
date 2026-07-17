/**
 * Dispatch RepoDiet analysis via GitHub repository_dispatch.
 * Requires Contents: Read and write on smokychain22/agentPass (fine-grained PAT).
 * Secrets never appear in the client_payload — only opaque identifiers.
 */

import { createHash } from "node:crypto";
import { nanoid } from "nanoid";

export const ANALYSIS_WORKFLOW_FILE = "repodiet-analysis-worker.yml";
export const ACTIONS_WORKER_ID = "github-actions/ubuntu-latest";
export const REPOSITORY_DISPATCH_EVENT = "repodiet_analysis";

export const JOB_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
export const REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
export const DISPATCH_NONCE_RE = /^[A-Za-z0-9_-]{20,256}$/;

export type DispatchEnvironment = "production" | "preview";

export interface DispatchWorkflowInput {
  jobId: string;
  requestId: string;
  dispatchNonce: string;
  environment: DispatchEnvironment;
  /** Public API origin — optional in payload; claim job uses production default when omitted. */
  apiBaseUrl?: string;
}

export interface DispatchWorkflowResult {
  ok: true;
  /** repository_dispatch returns 204 — run id is recorded later by the claim job. */
  workflowRunId?: undefined;
  workflowRunUrl?: undefined;
  dispatchedAt: string;
  dispatchNonceDigest: string;
  owner: string;
  repo: string;
  eventType: typeof REPOSITORY_DISPATCH_EVENT;
}

export type DispatcherFailureCode =
  | "DISPATCH_TOKEN_MISSING"
  | "DISPATCH_TOKEN_INVALID"
  | "DISPATCH_PERMISSION_DENIED"
  | "DISPATCH_REPOSITORY_UNAVAILABLE"
  | "DISPATCH_FAILED"
  | "WORKFLOW_NOT_ON_MAIN"
  | "WORKFLOW_TRIGGER_MISSING"
  | "WORKFLOW_DISABLED"
  | "ACTIONS_DISABLED"
  | "GITHUB_API_UNREACHABLE"
  | "REPO_CONFIG_MISSING"
  | "INVALID_DISPATCH_PAYLOAD";

export interface DispatchWorkflowFailure {
  ok: false;
  code: DispatcherFailureCode;
  message: string;
  retryable: boolean;
}

export function actionsRepo(): { owner: string; repo: string } | null {
  const full =
    process.env.REPODIET_ACTIONS_REPO?.trim() ||
    process.env.GITHUB_REPOSITORY?.trim() ||
    "smokychain22/agentPass";
  const [owner, repo] = full.split("/");
  if (!owner || !repo) return null;
  return { owner, repo };
}

export function dispatchToken(): string | undefined {
  return process.env.REPODIET_ACTIONS_DISPATCH_TOKEN?.trim() || undefined;
}

export function digestDispatchNonce(nonce: string): string {
  return createHash("sha256").update(nonce).digest("hex").slice(0, 32);
}

export function validateDispatchPayload(input: {
  jobId?: string;
  requestId?: string;
  dispatchNonce?: string;
  environment?: string;
}): { ok: true; value: DispatchWorkflowInput } | { ok: false; code: "INVALID_DISPATCH_PAYLOAD"; message: string } {
  const jobId = input.jobId?.trim() ?? "";
  const requestId = input.requestId?.trim() ?? "";
  const dispatchNonce = input.dispatchNonce?.trim() ?? "";
  const environment = input.environment?.trim() ?? "";

  if (!JOB_ID_RE.test(jobId)) {
    return { ok: false, code: "INVALID_DISPATCH_PAYLOAD", message: "Invalid jobId." };
  }
  if (!REQUEST_ID_RE.test(requestId)) {
    return { ok: false, code: "INVALID_DISPATCH_PAYLOAD", message: "Invalid requestId." };
  }
  if (!DISPATCH_NONCE_RE.test(dispatchNonce)) {
    return { ok: false, code: "INVALID_DISPATCH_PAYLOAD", message: "Invalid dispatchNonce." };
  }
  if (environment !== "production" && environment !== "preview") {
    return { ok: false, code: "INVALID_DISPATCH_PAYLOAD", message: "Invalid environment." };
  }
  return {
    ok: true,
    value: { jobId, requestId, dispatchNonce, environment },
  };
}

export function isActionsDispatcherConfigured(): boolean {
  return Boolean(dispatchToken() && actionsRepo());
}

function githubHeaders(token: string): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": "2022-11-28",
  };
}

/**
 * Trigger repository_dispatch. GitHub returns 204 with no run id.
 * workflowRunId is persisted later by the trusted claim job via github.run_id.
 */
export async function dispatchAnalysisWorkflow(
  input: DispatchWorkflowInput
): Promise<DispatchWorkflowResult | DispatchWorkflowFailure> {
  const validated = validateDispatchPayload(input);
  if (!validated.ok) {
    return { ok: false, code: validated.code, message: validated.message, retryable: false };
  }

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

  const url = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/dispatches`;
  const dispatchedAt = new Date().toISOString();

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        ...githubHeaders(token),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        event_type: REPOSITORY_DISPATCH_EVENT,
        client_payload: {
          jobId: validated.value.jobId,
          requestId: validated.value.requestId,
          dispatchNonce: validated.value.dispatchNonce,
          environment: validated.value.environment,
          ...(input.apiBaseUrl
            ? { apiBaseUrl: input.apiBaseUrl.replace(/\/$/, "") }
            : {}),
        },
      }),
    });
  } catch (err) {
    return {
      ok: false,
      code: "GITHUB_API_UNREACHABLE",
      message: err instanceof Error ? err.message : "GitHub dispatch network failure.",
      retryable: true,
    };
  }

  if (response.status === 401) {
    return {
      ok: false,
      code: "DISPATCH_TOKEN_INVALID",
      message: "GitHub rejected the Actions dispatch token.",
      retryable: false,
    };
  }
  if (response.status === 403) {
    return {
      ok: false,
      code: "DISPATCH_PERMISSION_DENIED",
      message: "Dispatch token lacks Contents write on smokychain22/agentPass.",
      retryable: false,
    };
  }
  if (response.status === 404) {
    return {
      ok: false,
      code: "DISPATCH_REPOSITORY_UNAVAILABLE",
      message: "Dispatch repository not found or inaccessible.",
      retryable: false,
    };
  }
  if (response.status !== 204 && !response.ok) {
    const text = await response.text().catch(() => "");
    return {
      ok: false,
      code: "DISPATCH_FAILED",
      message: `GitHub repository_dispatch failed (${response.status}): ${text.slice(0, 200)}`,
      retryable: response.status >= 500,
    };
  }

  return {
    ok: true,
    dispatchedAt,
    dispatchNonceDigest: digestDispatchNonce(validated.value.dispatchNonce),
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    eventType: REPOSITORY_DISPATCH_EVENT,
  };
}

export interface DispatcherHealthProbe {
  dispatcherReady: boolean;
  reason?: DispatcherFailureCode;
  message?: string;
  checkedAt: string;
  owner?: string;
  repo?: string;
  workflowPath?: string;
  triggerOk?: boolean;
}

/**
 * Verify dispatcher readiness beyond env-var presence.
 * Never returns or logs the token value.
 */
export async function probeActionsDispatcherHealth(): Promise<DispatcherHealthProbe> {
  const checkedAt = new Date().toISOString();
  const token = dispatchToken();
  if (!token) {
    return {
      dispatcherReady: false,
      reason: "DISPATCH_TOKEN_MISSING",
      message: "REPODIET_ACTIONS_DISPATCH_TOKEN is not configured.",
      checkedAt,
    };
  }
  const repoInfo = actionsRepo();
  if (!repoInfo || `${repoInfo.owner}/${repoInfo.repo}` !== "smokychain22/agentPass") {
    return {
      dispatcherReady: false,
      reason: "REPO_CONFIG_MISSING",
      message: "Dispatch repository must be smokychain22/agentPass.",
      checkedAt,
    };
  }

  try {
    const repoRes = await fetch(
      `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}`,
      { headers: githubHeaders(token) }
    );
    if (repoRes.status === 401) {
      return {
        dispatcherReady: false,
        reason: "DISPATCH_TOKEN_INVALID",
        message: "Dispatch token is invalid.",
        checkedAt,
        owner: repoInfo.owner,
        repo: repoInfo.repo,
      };
    }
    if (repoRes.status === 403) {
      return {
        dispatcherReady: false,
        reason: "DISPATCH_PERMISSION_DENIED",
        message: "Dispatch token cannot access agentPass.",
        checkedAt,
        owner: repoInfo.owner,
        repo: repoInfo.repo,
      };
    }
    if (repoRes.status === 404 || !repoRes.ok) {
      return {
        dispatcherReady: false,
        reason: "DISPATCH_REPOSITORY_UNAVAILABLE",
        message: "agentPass repository unavailable to dispatch token.",
        checkedAt,
        owner: repoInfo.owner,
        repo: repoInfo.repo,
      };
    }

    const wfRes = await fetch(
      `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/contents/.github/workflows/${ANALYSIS_WORKFLOW_FILE}?ref=main`,
      { headers: githubHeaders(token) }
    );
    if (wfRes.status === 404) {
      return {
        dispatcherReady: false,
        reason: "WORKFLOW_NOT_ON_MAIN",
        message: "repodiet-analysis-worker.yml is not on main.",
        checkedAt,
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        workflowPath: `.github/workflows/${ANALYSIS_WORKFLOW_FILE}`,
      };
    }
    if (!wfRes.ok) {
      return {
        dispatcherReady: false,
        reason: "ACTIONS_DISABLED",
        message: `Cannot read workflow file (${wfRes.status}).`,
        checkedAt,
        owner: repoInfo.owner,
        repo: repoInfo.repo,
      };
    }

    const wfJson = (await wfRes.json()) as { content?: string; encoding?: string };
    let workflowText = "";
    if (wfJson.content && wfJson.encoding === "base64") {
      workflowText = Buffer.from(wfJson.content.replace(/\n/g, ""), "base64").toString("utf8");
    }
    const triggerOk =
      /repository_dispatch/.test(workflowText) &&
      /repodiet_analysis/.test(workflowText) &&
      !/REPODIET_ACTIONS_DISPATCH_TOKEN/.test(workflowText);

    if (!triggerOk) {
      return {
        dispatcherReady: false,
        reason: "WORKFLOW_TRIGGER_MISSING",
        message: "Workflow missing repository_dispatch/repodiet_analysis or leaks dispatch token name into jobs.",
        checkedAt,
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        workflowPath: `.github/workflows/${ANALYSIS_WORKFLOW_FILE}`,
        triggerOk: false,
      };
    }

    return {
      dispatcherReady: true,
      checkedAt,
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      workflowPath: `.github/workflows/${ANALYSIS_WORKFLOW_FILE}`,
      triggerOk: true,
    };
  } catch (err) {
    return {
      dispatcherReady: false,
      reason: "GITHUB_API_UNREACHABLE",
      message: err instanceof Error ? err.message : "GitHub API unreachable.",
      checkedAt,
      owner: repoInfo.owner,
      repo: repoInfo.repo,
    };
  }
}

export function createCorrelationId(): string {
  return nanoid(10);
}
