import { after } from "next/server";
import { nanoid } from "nanoid";
import { getAppBaseUrl } from "@/lib/github-app/app-base-url";
import { isServerlessRuntime } from "@/lib/server/runtime-env";
import {
  getSandboxRun,
  isTerminalSandboxStatus,
  updateSandboxRun,
} from "@/lib/execution/sandbox-run-store";
import type { SandboxRun, SandboxRunPayload } from "@/lib/execution/sandbox-run-types";
import { isActiveSandboxStatus, isStaleActiveSandboxRun, runSandboxExecutionOnce } from "@/lib/execution/execute-sandbox-run";
import { workerApiKeyConfigured } from "@/lib/worker/worker-auth";
import {
  dispatchSandboxValidationWorkflow,
  isSandboxActionsDispatcherConfigured,
} from "@/lib/github-actions/dispatch-sandbox-validation";
import { createDispatchNonce, dispatchNonceTtlMs, storeDispatchNonce } from "@/lib/github-actions/dispatch-nonce-store";
import { publicApiBaseUrl } from "@/lib/deep-scan/dispatch-queued-job";

const REDISPATCH_MS = 30_000;

function nowIso(): string {
  return new Date().toISOString();
}

export function shouldDispatchSandboxExecution(run: SandboxRun): boolean {
  if (isTerminalSandboxStatus(run.status)) return false;
  if (isActiveSandboxStatus(run.status) && !isStaleActiveSandboxRun(run)) return false;

  /**
   * A live claim lease means a worker has already taken this run and is
   * working on it — never dispatch a second one on top of it.
   *
   * Without this, the GitHub Actions path duplicate-dispatched every single
   * run in production (observed on sandbox worker runs #1/#2/#3, #5/#6 and
   * #7/#8: same sandboxRunId, different dispatchNonce, one green + one red).
   * The `isActiveSandboxStatus` guard above cannot catch it, because those
   * stage names (`cloning`, `baseline_verification`, …) belong to the Vercel
   * Sandbox executor. An Actions run instead sits in `starting` from the
   * moment `claimSandboxRun` takes it until `complete` reports back, and a
   * GitHub-hosted runner can legitimately stay queued for minutes — far
   * longer than REDISPATCH_MS. So the redispatch below kept firing while a
   * perfectly healthy worker was already mid-flight.
   *
   * The lease is the authoritative "someone owns this" signal and already
   * expires on its own (SANDBOX_CLAIM_LEASE_MS), so an abandoned worker
   * still gets reclaimed — this only suppresses dispatch while the claim is
   * genuinely live.
   */
  if (run.claimedBy && run.leaseExpiresAt && Date.parse(run.leaseExpiresAt) > Date.now()) {
    return false;
  }

  const lastDispatch = run.executionDispatchedAt
    ? new Date(run.executionDispatchedAt).getTime()
    : 0;
  const sinceDispatch = Date.now() - lastDispatch;

  if (["queued", "starting", "resolving_repository"].includes(run.status)) {
    return sinceDispatch >= REDISPATCH_MS;
  }

  const ageMs = Date.now() - new Date(run.updatedAt).getTime();
  return ageMs >= REDISPATCH_MS;
}

export async function dispatchSandboxExecution(
  runId: string,
  payload?: SandboxRunPayload
): Promise<void> {
  const run = await getSandboxRun(runId);
  if (!run) return;
  if (!shouldDispatchSandboxExecution(run)) return;

  await updateSandboxRun(runId, {
    status: run.status === "queued" ? "starting" : run.status,
    progress: "Dispatching isolated sandbox worker",
    executionDispatchedAt: nowIso(),
    payload: payload ?? run.payload,
  });

  if (isServerlessRuntime() && isSandboxActionsDispatcherConfigured()) {
    void dispatchSandboxValidationViaActions(runId).catch((err) => {
      console.error("[repodiet-sandbox-dispatch] failed to dispatch GitHub Actions sandbox worker", err);
    });
    return;
  }

  if (isServerlessRuntime() && workerApiKeyConfigured()) {
    // Serves deployments where Vercel Sandbox (@vercel/sandbox) is provisioned —
    // executeRepositoryCleanup uses it when available. Without either that or the
    // Actions dispatcher above, this route has no git binary and the run stays
    // pending_sandbox / eventually SANDBOX_UNAVAILABLE, same as before this change.
    const url = `${getAppBaseUrl()}/api/internal/sandbox-runs/execute`;
    void fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WORKER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ runId }),
    }).catch((err) => {
      console.error("[repodiet-sandbox-dispatch] failed to dispatch execute route", err);
    });
    return;
  }

  const runInline = () => {
    void runSandboxExecutionOnce(runId).catch((err) => {
      console.error("[repodiet-sandbox-dispatch] inline execution failed", err);
    });
  };

  if (isServerlessRuntime()) {
    after(runInline);
    return;
  }

  runInline();
}

function dispatchEnvironment(): "production" | "preview" {
  return process.env.VERCEL_ENV === "preview" ? "preview" : "production";
}

/**
 * Fire a repository_dispatch to the sandbox validation workflow. Fire-and-forget
 * by design — dispatchSandboxExecution is itself re-invoked on the existing
 * REDISPATCH_MS cadence (via shouldDispatchSandboxExecution) whenever the run is
 * still queued/starting, so a dropped or failed dispatch call is retried without
 * a separate backoff state machine.
 */
async function dispatchSandboxValidationViaActions(runId: string): Promise<void> {
  const nonce = createDispatchNonce();
  const requestId = `req_${nanoid(12)}`;
  const expiresAt = new Date(Date.now() + dispatchNonceTtlMs()).toISOString();
  await storeDispatchNonce({
    nonce,
    jobId: runId,
    requestId,
    createdAt: nowIso(),
    expiresAt,
  });

  const result = await dispatchSandboxValidationWorkflow({
    runId,
    requestId,
    dispatchNonce: nonce,
    environment: dispatchEnvironment(),
    apiBaseUrl: publicApiBaseUrl(),
  });

  if (!result.ok) {
    console.error(
      `[repodiet-sandbox-dispatch] repository_dispatch failed (${result.code}): ${result.message}`
    );
  }
}
