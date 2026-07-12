import { nanoid } from "nanoid";
import {
  getPersistentRecord,
  setPersistentRecord,
} from "@/lib/store/persistent-store";
import type {
  SandboxRun,
  SandboxRunPayload,
  SandboxRunResult,
  SandboxRunStatus,
} from "./sandbox-run-types";

const COLLECTION = "repository_jobs" as const;

function nowIso(): string {
  return new Date().toISOString();
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
    statusHistory: [...(existing.statusHistory ?? []), { status: "queued", at: t, detail: "manual retry" }],
    updatedAt: t,
  };
  await saveSandboxRun(run);
  return run;
}
