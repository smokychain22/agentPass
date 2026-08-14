/**
 * Dispatch RepoDiet sandbox patch validation via GitHub repository_dispatch.
 * Sibling of dispatch-analysis.ts, reusing its token/repo config and nonce
 * digest helpers — same trust boundary (Contents: Read and write on
 * smokychain22/agentPass), different event_type/workflow so an analysis
 * dispatch can never accidentally claim a sandbox run or vice versa.
 */

import {
  actionsRepo,
  digestDispatchNonce,
  dispatchToken,
  DISPATCH_NONCE_RE,
  JOB_ID_RE,
  REQUEST_ID_RE,
  type DispatchEnvironment,
  type DispatcherFailureCode,
} from "./dispatch-analysis";

export const SANDBOX_VALIDATION_WORKFLOW_FILE = "repodiet-sandbox-validation-worker.yml";
export const SANDBOX_REPOSITORY_DISPATCH_EVENT = "repodiet_sandbox_validation";

export interface DispatchSandboxValidationInput {
  runId: string;
  requestId: string;
  dispatchNonce: string;
  environment: DispatchEnvironment;
  apiBaseUrl?: string;
}

export interface DispatchSandboxValidationResult {
  ok: true;
  dispatchedAt: string;
  dispatchNonceDigest: string;
  owner: string;
  repo: string;
  eventType: typeof SANDBOX_REPOSITORY_DISPATCH_EVENT;
}

export interface DispatchSandboxValidationFailure {
  ok: false;
  code: DispatcherFailureCode;
  message: string;
  retryable: boolean;
}

export function isSandboxActionsDispatcherConfigured(): boolean {
  return Boolean(dispatchToken() && actionsRepo());
}

function validatePayload(
  input: DispatchSandboxValidationInput
): { ok: true } | { ok: false; code: "INVALID_DISPATCH_PAYLOAD"; message: string } {
  if (!JOB_ID_RE.test(input.runId)) {
    return { ok: false, code: "INVALID_DISPATCH_PAYLOAD", message: "Invalid runId." };
  }
  if (!REQUEST_ID_RE.test(input.requestId)) {
    return { ok: false, code: "INVALID_DISPATCH_PAYLOAD", message: "Invalid requestId." };
  }
  if (!DISPATCH_NONCE_RE.test(input.dispatchNonce)) {
    return { ok: false, code: "INVALID_DISPATCH_PAYLOAD", message: "Invalid dispatchNonce." };
  }
  if (input.environment !== "production" && input.environment !== "preview") {
    return { ok: false, code: "INVALID_DISPATCH_PAYLOAD", message: "Invalid environment." };
  }
  return { ok: true };
}

function githubHeaders(token: string): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": "2022-11-28",
  };
}

/**
 * Trigger repository_dispatch for the sandbox validation workflow. GitHub
 * returns 204 with no run id — the trusted claim job self-reports its own
 * workflowRunId/workflowRunUrl via claim-exchange once it starts.
 */
export async function dispatchSandboxValidationWorkflow(
  input: DispatchSandboxValidationInput
): Promise<DispatchSandboxValidationResult | DispatchSandboxValidationFailure> {
  const validated = validatePayload(input);
  if (!validated.ok) {
    return { ok: false, code: validated.code, message: validated.message, retryable: false };
  }

  const token = dispatchToken();
  if (!token) {
    return {
      ok: false,
      code: "DISPATCH_TOKEN_MISSING",
      message: "REPODIET_ACTIONS_DISPATCH_TOKEN is not configured. Cannot start GitHub Actions sandbox worker.",
      retryable: false,
    };
  }
  const repoInfo = actionsRepo();
  if (!repoInfo) {
    return { ok: false, code: "REPO_CONFIG_MISSING", message: "REPODIET_ACTIONS_REPO is invalid.", retryable: false };
  }

  const url = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/dispatches`;
  const dispatchedAt = new Date().toISOString();

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { ...githubHeaders(token), "content-type": "application/json" },
      body: JSON.stringify({
        event_type: SANDBOX_REPOSITORY_DISPATCH_EVENT,
        client_payload: {
          runId: input.runId,
          requestId: input.requestId,
          dispatchNonce: input.dispatchNonce,
          environment: input.environment,
          ...(input.apiBaseUrl ? { apiBaseUrl: input.apiBaseUrl.replace(/\/$/, "") } : {}),
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
    return { ok: false, code: "DISPATCH_TOKEN_INVALID", message: "GitHub rejected the Actions dispatch token.", retryable: false };
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
    return { ok: false, code: "DISPATCH_REPOSITORY_UNAVAILABLE", message: "Dispatch repository not found or inaccessible.", retryable: false };
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
    dispatchNonceDigest: digestDispatchNonce(input.dispatchNonce),
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    eventType: SANDBOX_REPOSITORY_DISPATCH_EVENT,
  };
}
