import { nanoid } from "nanoid";
import {
  getPersistentRecord,
  setPersistentRecord,
} from "@/lib/store/persistent-store";
import { createClaimHandle } from "@/lib/github-actions/callback-auth";
import {
  SANDBOX_CLAIM_LEASE_MS,
  type SandboxRun,
  type SandboxRunPayload,
  type SandboxRunResult,
  type SandboxRunStatus,
} from "./sandbox-run-types";

const COLLECTION = "repository_jobs" as const;

function nowIso(): string {
  return new Date().toISOString();
}

function leaseExpiresAt(): string {
  return new Date(Date.now() + SANDBOX_CLAIM_LEASE_MS).toISOString();
}

const TERMINAL_STATUSES: SandboxRunStatus[] = [
  "delivered",
  "failed",
  "blocked",
  "timed_out",
  "ready_for_delivery",
];

export function isTerminalSandboxStatus(status: SandboxRunStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function createSandboxRunId(): string {
  return `sandbox_run_${nanoid(12)}`;
}

export async function getSandboxRun(id: string): Promise<SandboxRun | undefined> {
  return getPersistentRecord<SandboxRun>(COLLECTION, id);
}

export async function getSandboxRunByCleanupRunId(
  cleanupRunId: string
): Promise<SandboxRun | undefined> {
  const index = await getPersistentRecord<string>(COLLECTION, `sandbox_by_cleanup:${cleanupRunId}`);
  if (!index) return undefined;
  return getSandboxRun(index);
}

export async function saveSandboxRun(run: SandboxRun): Promise<void> {
  run.updatedAt = nowIso();
  await setPersistentRecord(COLLECTION, run.id, run);
  await setPersistentRecord(COLLECTION, `sandbox_by_cleanup:${run.cleanupRunId}`, run.id);
}

export async function createSandboxRun(payload: SandboxRunPayload): Promise<SandboxRun> {
  const existing = await getSandboxRunByCleanupRunId(payload.cleanupRunId);
  if (existing && !["failed", "blocked", "timed_out", "delivered", "ready_for_delivery"].includes(existing.status)) {
    return existing;
  }

  const t = nowIso();
  const run: SandboxRun = {
    id: createSandboxRunId(),
    cleanupRunId: payload.cleanupRunId,
    repositoryOwner: payload.repositoryOwner,
    repositoryName: payload.repositoryName,
    branch: payload.branch,
    baseCommitSha: payload.baseCommitSha,
    status: "queued",
    payload,
    statusHistory: [{ status: "queued", at: t }],
    createdAt: t,
    updatedAt: t,
  };
  await saveSandboxRun(run);
  return run;
}

export async function updateSandboxRun(
  id: string,
  patch: Partial<SandboxRun> & { status?: SandboxRunStatus; progressDetail?: string }
): Promise<SandboxRun | undefined> {
  const run = await getSandboxRun(id);
  if (!run) return undefined;
  const { progressDetail, ...rest } = patch;
  const next: SandboxRun = {
    ...run,
    ...rest,
    progress: patch.progress ?? run.progress,
    statusHistory:
      patch.status && patch.status !== run.status
        ? [...(run.statusHistory ?? []), { status: patch.status, at: nowIso(), detail: progressDetail }]
        : run.statusHistory,
    updatedAt: nowIso(),
  };
  await saveSandboxRun(next);
  return next;
}

export async function completeSandboxRun(
  id: string,
  result: SandboxRunResult,
  status: SandboxRunStatus = "ready_for_delivery"
): Promise<SandboxRun | undefined> {
  return updateSandboxRun(id, {
    status,
    result,
    completedAt: nowIso(),
    progressDetail: "completed",
  });
}

export async function failSandboxRun(
  id: string,
  failureCode: string,
  failureMessage: string
): Promise<SandboxRun | undefined> {
  return updateSandboxRun(id, {
    status: "failed",
    failureCode,
    failureMessage,
    completedAt: nowIso(),
    progressDetail: failureMessage,
  });
}

export class SandboxRunClaimError extends Error {
  constructor(
    public readonly code: "NOT_CLAIMABLE" | "CLAIMED_BY_OTHER" | "CLAIM_MISMATCH" | "LEASE_EXPIRED",
    message: string
  ) {
    super(message);
  }
}

/** True when no worker currently holds a live lease on this run. */
function isLeaseFree(run: SandboxRun, workerId: string): boolean {
  if (!run.claimedBy) return true;
  if (run.claimedBy === workerId) return true;
  if (!run.leaseExpiresAt) return false;
  return Date.parse(run.leaseExpiresAt) <= Date.now();
}

/**
 * Atomically claim a specific sandbox run for an external worker (GitHub Actions
 * on-demand validate job). Mirrors `claimDeepScanJobById` — a stale/expired lease
 * may be reclaimed by a different worker; an unexpired lease held by another
 * worker is rejected.
 */
export async function claimSandboxRun(
  runId: string,
  workerId: string
): Promise<
  | { ok: true; run: SandboxRun; alreadyClaimed: boolean }
  | { ok: false; code: "NOT_FOUND" | "TERMINAL" | "CLAIMED_BY_OTHER"; message: string }
> {
  const run = await getSandboxRun(runId);
  if (!run) return { ok: false, code: "NOT_FOUND", message: "Sandbox run not found." };
  if (isTerminalSandboxStatus(run.status)) {
    return { ok: false, code: "TERMINAL", message: `Sandbox run is terminal (${run.status}).` };
  }
  if (run.claimedBy === workerId && run.leaseExpiresAt && Date.parse(run.leaseExpiresAt) > Date.now()) {
    return { ok: true, run, alreadyClaimed: true };
  }
  if (!isLeaseFree(run, workerId)) {
    return { ok: false, code: "CLAIMED_BY_OTHER", message: "Sandbox run already claimed by another worker." };
  }

  const t = nowIso();
  const claimToken = `sbclaim_${nanoid(16)}`;
  const claimed: SandboxRun = {
    ...run,
    status: run.status === "queued" ? "starting" : run.status,
    claimedBy: workerId,
    claimToken,
    claimHandle: createClaimHandle(),
    claimedAt: t,
    leaseExpiresAt: leaseExpiresAt(),
    claimAttempts: (run.claimAttempts ?? 0) + 1,
    progress: `Claimed by ${workerId}`,
    statusHistory: [...(run.statusHistory ?? []), { status: run.status, at: t, detail: `claimed by ${workerId}` }],
  };
  await saveSandboxRun(claimed);
  return { ok: true, run: claimed, alreadyClaimed: false };
}

/** Throws unless `workerId`/`claimToken` match the current live lease. */
export function assertSandboxRunClaim(run: SandboxRun, workerId: string, claimToken: string): void {
  if (!run.claimedBy || run.claimedBy !== workerId) {
    throw new SandboxRunClaimError("CLAIM_MISMATCH", "Worker does not own this claim.");
  }
  if (!run.claimToken || run.claimToken !== claimToken) {
    throw new SandboxRunClaimError("CLAIM_MISMATCH", "Claim token mismatch.");
  }
  if (run.leaseExpiresAt && Date.parse(run.leaseExpiresAt) <= Date.now()) {
    throw new SandboxRunClaimError("LEASE_EXPIRED", "Sandbox run claim lease expired.");
  }
}

/** Extend the lease of a live claim (worker heartbeat / stage progress). */
export async function heartbeatSandboxRun(
  runId: string,
  workerId: string,
  claimToken: string,
  detail?: string,
  status?: SandboxRunStatus
): Promise<SandboxRun | undefined> {
  const run = await getSandboxRun(runId);
  if (!run) return undefined;
  assertSandboxRunClaim(run, workerId, claimToken);

  const t = nowIso();
  const next: SandboxRun = {
    ...run,
    status: status ?? run.status,
    progress: detail ?? run.progress,
    leaseExpiresAt: leaseExpiresAt(),
    statusHistory:
      status && status !== run.status
        ? [...(run.statusHistory ?? []), { status, at: t, detail }]
        : run.statusHistory,
    updatedAt: t,
  };
  await saveSandboxRun(next);
  return next;
}

export async function retrySandboxRun(cleanupRunId: string): Promise<SandboxRun | null> {
  const existing = await getSandboxRunByCleanupRunId(cleanupRunId);
  if (!existing) return null;
  if (!["failed", "blocked", "timed_out"].includes(existing.status)) {
    return existing;
  }
  const t = nowIso();
  const run: SandboxRun = {
    ...existing,
    status: "queued",
    workflowRunId: undefined,
    sandboxId: undefined,
    failureCode: undefined,
    failureMessage: undefined,
    result: undefined,
    completedAt: undefined,
    claimedBy: undefined,
    claimToken: undefined,
    claimHandle: undefined,
    claimedAt: undefined,
    leaseExpiresAt: undefined,
    claimAttempts: undefined,
    workflowRunUrl: undefined,
    workflowRunAttempt: undefined,
    workflowName: undefined,
    workflowRepository: undefined,
    verifiedChanges: undefined,
    verifiedPaths: undefined,
    statusHistory: [...(existing.statusHistory ?? []), { status: "queued", at: t, detail: "manual retry" }],
    updatedAt: t,
  };
  await saveSandboxRun(run);
  return run;
}
