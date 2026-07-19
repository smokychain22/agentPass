/**
 * Durable GitHub Actions dispatch for deep-scan jobs.
 * Shared by A2A intake, findings analyze, deep-scan enqueue, and stale-queue recovery.
 */

import { nanoid } from "nanoid";
import {
  dispatchAnalysisWorkflow,
  isActionsDispatcherConfigured,
  digestDispatchNonce,
  actionsRepo,
  dispatchToken,
} from "@/lib/github-actions/dispatch-analysis";
import {
  analysisConfigDigest,
  createDispatchNonce,
  dispatchNonceTtlMs,
  storeDispatchNonce,
} from "@/lib/github-actions/dispatch-nonce-store";
import { getDeepScanJob, updateDeepScanStage } from "@/lib/deep-scan/job-store";
import type { DeepScanJob } from "@/lib/deep-scan/types";
import { touchMarketplaceHealth } from "@/lib/okx/marketplace-telemetry";

export type DurableDispatchState =
  | "NOT_DISPATCHED"
  | "DISPATCHING"
  | "DISPATCHED"
  | "CLAIMED"
  | "RUNNING"
  | "RETRY_PENDING"
  | "FAILED_RETRYABLE"
  | "FAILED_TERMINAL"
  | "COMPLETED";

export const MAX_DISPATCH_ATTEMPTS = 5;
/** Grace before treating an undispatched QUEUED job as broken. */
export const DISPATCH_STARTUP_GRACE_MS = 30_000;
/** Backoff base between redispatches (exponential). */
export const DISPATCH_RETRY_BASE_MS = 15_000;

const ACTIVE_DISPATCH_STAGES = new Set([
  "DISPATCHING",
  "DISPATCHED",
  "WAITING_FOR_RUNNER",
  "CLAIMED",
  "INVENTORY",
  "RESOLVING_PROJECTS",
  "BUILDING_GRAPH",
  "RUNNING_ANALYZERS",
  "RUNNING_JSCpd",
  "RUNNING_KNIP",
  "RUNNING_MADGE",
  "RUNNING_INTERNAL_HEURISTICS",
  "NORMALIZING_FINDINGS",
  "VALIDATING_EVIDENCE",
  "PERSISTING_RESULTS",
  "BASELINE_VERIFICATION",
  "AWAITING_SCOPE",
  "PATCHING",
  "VERIFYING",
  "CREATING_PR",
  "MONITORING_CHECKS",
  "SIGNING_PROOF",
  "DELIVERY_READY",
  "READY",
  "COMPLETED",
  "PREPARING_ARCHIVE",
  "DOWNLOADING_ARCHIVE",
  "ARCHIVE_READY",
]);

export interface DispatchMeta {
  dispatchState: DurableDispatchState;
  dispatchAttempt: number;
  dispatchToken?: string;
  dispatchTokenDigest?: string;
  dispatchRequestedAt?: string;
  lastDispatchError?: string;
  lastDispatchErrorCode?: string;
  nextRetryAt?: string;
  workflowRunId?: string;
  workflowRunUrl?: string;
  lastWorkflowCheckAt?: string;
}

export function readDispatchMeta(job: DeepScanJob): DispatchMeta {
  const raw = (job.resultSummary?.dispatch ?? {}) as Record<string, unknown>;
  const attempt =
    typeof raw.dispatchAttempt === "number"
      ? raw.dispatchAttempt
      : typeof job.attemptCount === "number" && job.dispatchedAt
        ? Math.max(1, job.attemptCount)
        : 0;
  const state =
    (typeof raw.dispatchState === "string"
      ? (raw.dispatchState as DurableDispatchState)
      : undefined) ??
    (job.workflowRunId || job.claimedBy
      ? "CLAIMED"
      : job.stage === "FAILED_TERMINAL"
        ? "FAILED_TERMINAL"
        : job.stage === "FAILED_RETRYABLE"
          ? "FAILED_RETRYABLE"
          : job.stage === "READY" || job.stage === "COMPLETED"
            ? "COMPLETED"
            : job.dispatchedAt || job.stage === "DISPATCHED" || job.stage === "WAITING_FOR_RUNNER"
              ? "DISPATCHED"
              : job.stage === "DISPATCHING"
                ? "DISPATCHING"
                : "NOT_DISPATCHED");
  return {
    dispatchState: state,
    dispatchAttempt: attempt,
    dispatchToken: typeof raw.dispatchToken === "string" ? raw.dispatchToken : job.dispatchNonce,
    dispatchTokenDigest:
      typeof raw.dispatchNonceDigest === "string"
        ? raw.dispatchNonceDigest
        : typeof raw.dispatchTokenDigest === "string"
          ? raw.dispatchTokenDigest
          : undefined,
    dispatchRequestedAt:
      typeof raw.dispatchRequestedAt === "string" ? raw.dispatchRequestedAt : job.dispatchedAt,
    lastDispatchError:
      typeof raw.lastDispatchError === "string" ? raw.lastDispatchError : job.failureMessage,
    lastDispatchErrorCode:
      typeof raw.lastDispatchErrorCode === "string"
        ? raw.lastDispatchErrorCode
        : job.failureCode,
    nextRetryAt: typeof raw.nextRetryAt === "string" ? raw.nextRetryAt : undefined,
    workflowRunId: job.workflowRunId,
    workflowRunUrl: job.workflowRunUrl,
    lastWorkflowCheckAt:
      typeof raw.lastWorkflowCheckAt === "string" ? raw.lastWorkflowCheckAt : undefined,
  };
}

function mergeDispatchMeta(
  job: DeepScanJob,
  patch: Partial<DispatchMeta> & Record<string, unknown>
): Record<string, unknown> {
  const prev = (job.resultSummary?.dispatch ?? {}) as Record<string, unknown>;
  return {
    ...prev,
    ...patch,
  };
}

export function isAlreadyActivelyDispatched(job: DeepScanJob): boolean {
  if (job.workflowRunId) return true;
  if (job.claimedBy && job.leaseExpiresAt && Date.parse(job.leaseExpiresAt) > Date.now()) {
    return true;
  }
  return ACTIVE_DISPATCH_STAGES.has(job.stage) && Boolean(job.dispatchedAt);
}

/**
 * Public HTTPS origin that GitHub Actions workers must call back to.
 * On Preview, NEVER fall through to NEXT_PUBLIC_APP_URL when that points at
 * production — otherwise claim/analyze/complete mutate the wrong deployment
 * and leave Preview jobs stuck in INVENTORY.
 *
 * Also ignore a stale REPODIET_PUBLIC_API_BASE_URL that points at a different
 * Preview hostname than this deployment (common after branch renames).
 */
export function publicApiBaseUrl(
  env: Record<string, string | undefined> = process.env
): string {
  if (env.VERCEL_ENV === "preview") {
    const branchHost = stripHost(env.VERCEL_BRANCH_URL);
    const deployHost = stripHost(env.VERCEL_URL);
    const explicit = env.REPODIET_PUBLIC_API_BASE_URL?.trim();
    if (explicit) {
      const explicitHost = stripHost(explicit);
      const allowed = [branchHost, deployHost].filter(Boolean) as string[];
      if (
        explicitHost &&
        allowed.some(
          (h) =>
            explicitHost === h ||
            explicitHost.endsWith(`.${h}`) ||
            h.endsWith(`.${explicitHost}`) ||
            // Same project alias family: skillswap-*-skillswap7.vercel.app
            (explicitHost.includes("skillswap7.vercel.app") &&
              h.includes("skillswap7.vercel.app") &&
              explicitHost.split("-")[0] === h.split("-")[0] &&
              explicitHost === h)
        )
      ) {
        // Only accept exact match to this deployment/branch host — never a sibling Preview.
        if (allowed.includes(explicitHost)) {
          return `https://${explicitHost}`.replace(/\/$/, "");
        }
      }
      // Stale explicit Preview base — fall through to VERCEL_* hosts.
    }
    if (branchHost) return `https://${branchHost}`.replace(/\/$/, "");
    if (deployHost) return `https://${deployHost}`.replace(/\/$/, "");
  }
  return (
    env.REPODIET_PUBLIC_API_BASE_URL?.trim() ||
    env.NEXT_PUBLIC_APP_URL?.trim() ||
    (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : "") ||
    "https://skillswap-virid-kappa.vercel.app"
  ).replace(/\/$/, "");
}

function stripHost(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const raw = value.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  return raw.split("/")[0] || undefined;
}

function dispatchEnvironment(): "production" | "preview" {
  return process.env.VERCEL_ENV === "preview" ? "preview" : "production";
}

function nextRetryIso(attempt: number): string {
  const delay = Math.min(
    15 * 60_000,
    DISPATCH_RETRY_BASE_MS * Math.pow(2, Math.max(0, attempt - 1))
  );
  return new Date(Date.now() + delay).toISOString();
}

export interface DispatchQueuedJobResult {
  job: DeepScanJob;
  dispatched: boolean;
  dispatchState: DurableDispatchState;
  error?: string;
  errorCode?: string;
  correlatedRun?: boolean;
}

/**
 * Atomically advance a deep-scan job through GitHub Actions dispatch.
 * Idempotent when a live workflow run or active lease already exists.
 */
export async function dispatchQueuedDeepScanJob(input: {
  jobId: string;
  requestId?: string;
  tenantId?: string;
  /** Force another attempt even if recently dispatched (reconcile path). */
  force?: boolean;
}): Promise<DispatchQueuedJobResult> {
  let job = await getDeepScanJob(input.jobId);
  if (!job) {
    throw new Error(`Deep-scan job not found: ${input.jobId}`);
  }

  const meta = readDispatchMeta(job);
  if (!input.force && isAlreadyActivelyDispatched(job)) {
    const correlated = await correlateWorkflowRunForJob(job);
    job = correlated.job;
    return {
      job,
      dispatched: Boolean(job.dispatchedAt),
      dispatchState: readDispatchMeta(job).dispatchState,
      correlatedRun: correlated.matched,
    };
  }

  if (!isActionsDispatcherConfigured()) {
    const attempt = meta.dispatchAttempt + 1;
    const terminal = attempt >= MAX_DISPATCH_ATTEMPTS;
    const stage = terminal ? "FAILED_TERMINAL" : "FAILED_RETRYABLE";
    const message =
      "REPODIET_ACTIONS_DISPATCH_TOKEN is not configured — cannot start GitHub Actions analysis worker.";
    job =
      (await updateDeepScanStage(job.id, stage, message, {
        failureCode: "DISPATCH_TOKEN_MISSING",
        failureMessage: message,
        workerMode: "github_actions_on_demand",
        resultSummary: {
          ...(job.resultSummary ?? {}),
          dispatch: mergeDispatchMeta(job, {
            dispatchState: terminal ? "FAILED_TERMINAL" : "FAILED_RETRYABLE",
            dispatchAttempt: attempt,
            lastDispatchError: message,
            lastDispatchErrorCode: "DISPATCH_TOKEN_MISSING",
            nextRetryAt: terminal ? undefined : nextRetryIso(attempt),
          }),
        },
      })) ?? job;
    await touchMarketplaceHealth({
      dispatcherReady: false,
      recentWorkerFailureRate: 1,
    });
    return {
      job,
      dispatched: false,
      dispatchState: terminal ? "FAILED_TERMINAL" : "FAILED_RETRYABLE",
      error: message,
      errorCode: "DISPATCH_TOKEN_MISSING",
    };
  }

  const attempt = meta.dispatchAttempt + 1;
  if (attempt > MAX_DISPATCH_ATTEMPTS) {
    const message = `Dispatch attempts exhausted (${MAX_DISPATCH_ATTEMPTS}).`;
    job =
      (await updateDeepScanStage(job.id, "FAILED_TERMINAL", message, {
        failureCode: "DISPATCH_ATTEMPTS_EXHAUSTED",
        failureMessage: message,
        resultSummary: {
          ...(job.resultSummary ?? {}),
          dispatch: mergeDispatchMeta(job, {
            dispatchState: "FAILED_TERMINAL",
            dispatchAttempt: attempt - 1,
            lastDispatchError: message,
            lastDispatchErrorCode: "DISPATCH_ATTEMPTS_EXHAUSTED",
          }),
        },
      })) ?? job;
    return {
      job,
      dispatched: false,
      dispatchState: "FAILED_TERMINAL",
      error: message,
      errorCode: "DISPATCH_ATTEMPTS_EXHAUSTED",
    };
  }

  const requestId = input.requestId?.trim() || `req_${nanoid(12)}`;
  const tenantId = input.tenantId ?? job.tenantId ?? job.request.tenantId;
  const nonce = createDispatchNonce();
  const expiresAt = new Date(Date.now() + dispatchNonceTtlMs()).toISOString();

  job =
    (await updateDeepScanStage(job.id, "DISPATCHING", "Requesting GitHub Actions analysis worker", {
      dispatchNonce: nonce,
      workerMode: "github_actions_on_demand",
      resultSummary: {
        ...(job.resultSummary ?? {}),
        dispatch: mergeDispatchMeta(job, {
          dispatchState: "DISPATCHING",
          dispatchAttempt: attempt,
          dispatchToken: nonce,
          dispatchTokenDigest: digestDispatchNonce(nonce),
          dispatchRequestedAt: new Date().toISOString(),
        }),
      },
    })) ?? job;

  await storeDispatchNonce({
    nonce,
    jobId: job.id,
    tenantId,
    requestId,
    createdAt: new Date().toISOString(),
    expiresAt,
  });

  const digest = analysisConfigDigest({
    tenantId,
    structureScanId: job.request.structureScanId,
    repository: job.repositoryFullName ?? `${job.repositoryOwner}/${job.repositoryName}`,
    branch: job.branch ?? job.request.branch ?? "main",
    sourceCommit: job.sourceCommit ?? job.request.sourceCommit ?? "",
    projectRoot: job.projectRoot ?? job.request.projectRoot ?? ".",
  });

  const dispatched = await dispatchAnalysisWorkflow({
    jobId: job.id,
    requestId,
    dispatchNonce: nonce,
    environment: dispatchEnvironment(),
    apiBaseUrl: publicApiBaseUrl(),
  });

  if (dispatched.ok) {
    job =
      (await updateDeepScanStage(job.id, "DISPATCHED", "repository_dispatch accepted (HTTP 204)", {
        dispatchNonce: nonce,
        dispatchedAt: dispatched.dispatchedAt,
        workerMode: "github_actions_on_demand",
        analysisConfigDigest: digest,
        workflowRunId: undefined,
        workflowRunUrl: undefined,
        failureCode: undefined,
        failureMessage: undefined,
        resultSummary: {
          ...(job.resultSummary ?? {}),
          dispatch: mergeDispatchMeta(job, {
            eventType: dispatched.eventType,
            dispatchState: "DISPATCHED",
            dispatchAttempt: attempt,
            dispatchToken: nonce,
            dispatchNonceDigest: dispatched.dispatchNonceDigest,
            dispatchTokenDigest: dispatched.dispatchNonceDigest,
            dispatchRequestedAt: dispatched.dispatchedAt,
            lastDispatchError: undefined,
            lastDispatchErrorCode: undefined,
            nextRetryAt: undefined,
          }),
        },
      })) ?? job;

    job =
      (await updateDeepScanStage(
        job.id,
        "WAITING_FOR_RUNNER",
        "Waiting for GitHub Actions runner"
      )) ?? job;

    const correlated = await correlateWorkflowRunForJob(job, {
      maxWaitMs: 0,
      pollIntervalMs: 500,
    });
    job = correlated.job;

    await touchMarketplaceHealth({
      dispatcherReady: true,
      workerMode: "github_actions_on_demand",
      activeWorkflowRuns: 1,
      workerReady: true,
      workerReadySource: "github_actions_dispatcher",
      recentDispatchSuccessRate: 1,
    });

    return {
      job,
      dispatched: true,
      dispatchState: "DISPATCHED",
      correlatedRun: correlated.matched,
    };
  }

  const retryable = dispatched.retryable && attempt < MAX_DISPATCH_ATTEMPTS;
  const stage = retryable ? "FAILED_RETRYABLE" : "FAILED_TERMINAL";
  const dispatchState: DurableDispatchState = retryable
    ? "FAILED_RETRYABLE"
    : "FAILED_TERMINAL";
  job =
    (await updateDeepScanStage(job.id, stage, `Dispatch failed: ${dispatched.code}`, {
      failureCode: dispatched.code,
      failureMessage: dispatched.message,
      dispatchNonce: nonce,
      workerMode: "github_actions_on_demand",
      analysisConfigDigest: digest,
      resultSummary: {
        ...(job.resultSummary ?? {}),
        dispatch: mergeDispatchMeta(job, {
          dispatchState,
          dispatchAttempt: attempt,
          dispatchToken: nonce,
          dispatchTokenDigest: digestDispatchNonce(nonce),
          lastDispatchError: dispatched.message,
          lastDispatchErrorCode: dispatched.code,
          nextRetryAt: retryable ? nextRetryIso(attempt) : undefined,
        }),
      },
    })) ?? job;

  // Keep retryable jobs in the queue for reconcile redispatches.
  if (retryable) {
    job =
      (await updateDeepScanStage(job.id, "QUEUED", `Retry pending: ${dispatched.code}`, {
        failureCode: dispatched.code,
        failureMessage: dispatched.message,
        resultSummary: {
          ...(job.resultSummary ?? {}),
          dispatch: mergeDispatchMeta(job, {
            dispatchState: "RETRY_PENDING",
            dispatchAttempt: attempt,
            lastDispatchError: dispatched.message,
            lastDispatchErrorCode: dispatched.code,
            nextRetryAt: nextRetryIso(attempt),
          }),
        },
      })) ?? job;
  }

  await touchMarketplaceHealth({
    dispatcherReady: false,
    recentWorkerFailureRate: 1,
  });

  return {
    job,
    dispatched: false,
    dispatchState: retryable ? "RETRY_PENDING" : "FAILED_TERMINAL",
    error: dispatched.message,
    errorCode: dispatched.code,
  };
}

/**
 * Resolve workflow run id by matching run-name containing jobId + dispatch token digest.
 * repository_dispatch does not return a run id synchronously.
 */
export async function correlateWorkflowRunForJob(
  job: DeepScanJob,
  options?: { maxWaitMs?: number; pollIntervalMs?: number }
): Promise<{ job: DeepScanJob; matched: boolean }> {
  if (job.workflowRunId) {
    return { job, matched: true };
  }

  const meta = readDispatchMeta(job);
  const token = meta.dispatchToken ?? job.dispatchNonce;
  if (!token) return { job, matched: false };

  const tokenDigest = meta.dispatchTokenDigest ?? digestDispatchNonce(token);
  const repoInfo = actionsRepo();
  const tokenAuth = dispatchToken();
  if (!repoInfo || !tokenAuth) return { job, matched: false };

  const maxWaitMs = options?.maxWaitMs ?? 0;
  const pollIntervalMs = options?.pollIntervalMs ?? 2_000;
  const deadline = Date.now() + maxWaitMs;
  let current = job;

  do {
    const matched = await findMatchingWorkflowRun({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      jobId: job.id,
      dispatchToken: token,
      tokenDigest,
      authToken: tokenAuth,
    });

    current =
      (await updateDeepScanStage(current.id, current.stage, current.progress?.detail, {
        resultSummary: {
          ...(current.resultSummary ?? {}),
          dispatch: mergeDispatchMeta(current, {
            lastWorkflowCheckAt: new Date().toISOString(),
          }),
        },
        ...(matched
          ? {
              workflowRunId: String(matched.id),
              workflowRunUrl: matched.html_url,
            }
          : {}),
      })) ?? current;

    if (matched) {
      return { job: current, matched: true };
    }
    if (Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  } while (Date.now() < deadline);

  return { job: current, matched: false };
}

async function findMatchingWorkflowRun(input: {
  owner: string;
  repo: string;
  jobId: string;
  dispatchToken: string;
  tokenDigest: string;
  authToken: string;
}): Promise<{ id: number; html_url: string } | null> {
  try {
    const url = `https://api.github.com/repos/${input.owner}/${input.repo}/actions/workflows/repodiet-analysis-worker.yml/runs?event=repository_dispatch&per_page=25`;
    const res = await fetch(url, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${input.authToken}`,
        "x-github-api-version": "2022-11-28",
        "user-agent": "RepoDiet-dispatch-correlate",
      },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      workflow_runs?: Array<{
        id: number;
        html_url: string;
        name?: string;
        display_title?: string;
        status?: string;
      }>;
    };
    const runs = body.workflow_runs ?? [];
    for (const run of runs) {
      const label = `${run.name ?? ""} ${run.display_title ?? ""}`;
      // Match job id + dispatch token (or digest) — never time/branch alone.
      const hasJob = label.includes(input.jobId);
      const hasToken =
        label.includes(input.dispatchToken) || label.includes(input.tokenDigest);
      if (hasJob && hasToken) {
        return { id: run.id, html_url: run.html_url };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** True when a job is undispatched past grace and needs recovery. */
export function needsDispatchRecovery(job: DeepScanJob, now = Date.now()): boolean {
  if (job.workflowRunId) return false;
  if (job.claimedBy && job.leaseExpiresAt && Date.parse(job.leaseExpiresAt) > now) {
    return false;
  }
  if (
    job.stage !== "QUEUED" &&
    job.stage !== "DISPATCHING" &&
    job.stage !== "DISPATCHED" &&
    job.stage !== "WAITING_FOR_RUNNER" &&
    job.stage !== "FAILED_RETRYABLE"
  ) {
    const meta = readDispatchMeta(job);
    if (meta.dispatchState !== "RETRY_PENDING" && meta.dispatchState !== "NOT_DISPATCHED") {
      return false;
    }
  }
  const meta = readDispatchMeta(job);
  if (meta.dispatchState === "FAILED_TERMINAL" || meta.dispatchState === "COMPLETED") {
    return false;
  }
  if (meta.nextRetryAt && Date.parse(meta.nextRetryAt) > now) {
    return false;
  }
  const anchor = meta.dispatchRequestedAt ?? job.dispatchedAt ?? job.createdAt;
  const age = now - Date.parse(anchor);
  // Never redispatched, or dispatch accepted but no run/lease — recover after grace.
  return age >= DISPATCH_STARTUP_GRACE_MS;
}
