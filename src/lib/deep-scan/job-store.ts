import { nanoid } from "nanoid";
import {
  deletePersistentRecord,
  getPersistentRecord,
  setPersistentRecord,
} from "@/lib/store/persistent-store";
import { isWorkerAvailable } from "@/lib/worker/worker-instance-store";
import { trackDeepScanActive } from "./capacity";
import { dequeueDeepScanAtomic, enqueueDeepScanAtomic } from "./atomic-queue";
import type { DeepScanJob, DeepScanJobRequest, DeepScanStage } from "./types";
import { DEEP_SCAN_LEASE_MS, DEEP_SCAN_MAX_ATTEMPTS, stagePercent } from "./types";

const COLLECTION = "deep_scan_jobs" as const;

function nowIso(): string {
  return new Date().toISOString();
}

function leaseExpiresAt(): string {
  return new Date(Date.now() + DEEP_SCAN_LEASE_MS).toISOString();
}

export function createDeepScanJobId(): string {
  return `deep_scan_${nanoid(12)}`;
}

export class DeepScanWorkerUnavailableError extends Error {
  code = "WORKER_UNAVAILABLE" as const;
  constructor() {
    super("No RepoDiet worker heartbeat detected — deep scan cannot be claimed yet.");
  }
}

export async function getDeepScanJob(id: string): Promise<DeepScanJob | undefined> {
  return getPersistentRecord<DeepScanJob>(COLLECTION, id);
}

export async function saveDeepScanJob(job: DeepScanJob): Promise<void> {
  job.updatedAt = nowIso();
  await setPersistentRecord(COLLECTION, job.id, job);
  if (job.request.a2aTaskId) {
    await setPersistentRecord(COLLECTION, `by_a2a:${job.request.a2aTaskId}`, job.id);
  }
  const repoKey = `${job.repositoryOwner ?? ""}/${job.repositoryName ?? ""}`.toLowerCase();
  if (repoKey !== "/") {
    await setPersistentRecord(COLLECTION, `latest_repo:${repoKey}`, job.id);
  }
}

export async function getDeepScanJobByA2ATask(
  a2aTaskId: string
): Promise<DeepScanJob | undefined> {
  const id = await getPersistentRecord<string>(COLLECTION, `by_a2a:${a2aTaskId}`);
  if (!id) return undefined;
  return getDeepScanJob(id);
}

async function enqueueDeepScan(jobId: string): Promise<void> {
  await enqueueDeepScanAtomic(jobId);
}

async function dequeueDeepScan(): Promise<string | null> {
  return dequeueDeepScanAtomic();
}

export class DeepScanClaimError extends Error {
  constructor(
    public readonly code: "CLAIM_MISMATCH" | "LEASE_EXPIRED" | "NOT_CLAIMED",
    message: string
  ) {
    super(message);
  }
}

export function assertDeepScanClaim(
  job: DeepScanJob,
  workerId: string,
  claimToken?: string
): void {
  if (!job.claimedBy || job.claimedBy !== workerId) {
    throw new DeepScanClaimError("CLAIM_MISMATCH", "Worker does not own this claim.");
  }
  if (!job.claimToken || !claimToken || job.claimToken !== claimToken) {
    throw new DeepScanClaimError("CLAIM_MISMATCH", "Claim token mismatch.");
  }
  if (job.leaseExpiresAt && Date.parse(job.leaseExpiresAt) <= Date.now()) {
    throw new DeepScanClaimError("LEASE_EXPIRED", "Deep-scan lease expired.");
  }
}

export async function createDeepScanJob(
  request: DeepScanJobRequest,
  options?: { requireWorker?: boolean; idempotencyKey?: string }
): Promise<DeepScanJob> {
  if (options?.idempotencyKey) {
    const existingId = await getPersistentRecord<string>(
      COLLECTION,
      `idem:${options.idempotencyKey}`
    );
    if (existingId) {
      const existing = await getDeepScanJob(existingId);
      if (existing && existing.status !== "failed") return existing;
    }
  }

  if (options?.requireWorker && !(await isWorkerAvailable())) {
    throw new DeepScanWorkerUnavailableError();
  }

  const t = nowIso();
  const job: DeepScanJob = {
    id: createDeepScanJobId(),
    status: "queued",
    stage: "QUEUED",
    progress: { stage: "QUEUED", percent: 0, detail: "Deep scan queued", updatedAt: t },
    request,
    tenantId: request.tenantId,
    projectRoot: request.projectRoot || ".",
    branch: request.branch,
    sourceCommit: request.sourceCommit,
    attemptCount: 0,
    statusHistory: [{ stage: "QUEUED", at: t, detail: "enqueued" }],
    createdAt: t,
    updatedAt: t,
  };

  await saveDeepScanJob(job);
  await enqueueDeepScan(job.id);
  await trackDeepScanActive(job.id, true);
  if (options?.idempotencyKey) {
    await setPersistentRecord(COLLECTION, `idem:${options.idempotencyKey}`, job.id);
  }
  return job;
}

export async function updateDeepScanStage(
  id: string,
  stage: DeepScanStage,
  detail?: string,
  patch?: Partial<DeepScanJob>
): Promise<DeepScanJob | undefined> {
  const job = await getDeepScanJob(id);
  if (!job) return undefined;
  const t = nowIso();
  const terminal =
    stage === "READY" ||
    stage === "COMPLETED" ||
    stage === "FAILED" ||
    stage === "FAILED_RETRYABLE" ||
    stage === "FAILED_TERMINAL" ||
    stage === "CANCELLED";
  const next: DeepScanJob = {
    ...job,
    ...patch,
    stage,
    status:
      stage === "READY" || stage === "COMPLETED"
        ? "complete"
        : stage === "FAILED" ||
            stage === "FAILED_RETRYABLE" ||
            stage === "FAILED_TERMINAL" ||
            stage === "CANCELLED"
          ? "failed"
          : stage === "QUEUED"
            ? "queued"
            : "running",
    progress: {
      stage,
      percent: stagePercent(stage),
      detail,
      updatedAt: t,
    },
    statusHistory: [...job.statusHistory, { stage, at: t, detail }],
    updatedAt: t,
    completedAt: terminal ? t : job.completedAt,
  };
  await saveDeepScanJob(next);
  if (terminal) {
    await trackDeepScanActive(id, false);
  }
  return next;
}

export async function reclaimStaleDeepScanJobs(): Promise<number> {
  const activeIndex =
    (await getPersistentRecord<string[]>(COLLECTION, "active:index")) ?? [];
  let reclaimed = 0;
  for (const id of activeIndex) {
    const job = await getDeepScanJob(id);
    if (!job) continue;
    if (job.status === "complete" || job.status === "failed") {
      await trackDeepScanActive(id, false);
      continue;
    }
    if (job.stage === "READY" || job.stage === "COMPLETED") continue;
    const leaseExpired =
      !job.leaseExpiresAt || Date.parse(job.leaseExpiresAt) <= Date.now();
    if (job.claimedBy && leaseExpired) {
      const t = nowIso();
      const recovered: DeepScanJob = {
        ...job,
        status: "queued",
        stage: "QUEUED",
        claimedBy: undefined,
        claimToken: undefined,
        leaseExpiresAt: undefined,
        heartbeatAt: undefined,
        progress: {
          stage: "QUEUED",
          percent: 0,
          detail: "Requeued after stale lease",
          updatedAt: t,
        },
        statusHistory: [
          ...job.statusHistory,
          { stage: "QUEUED", at: t, detail: "stale lease recovery" },
        ],
        updatedAt: t,
      };
      await saveDeepScanJob(recovered);
      await enqueueDeepScan(id);
      reclaimed += 1;
    }
  }
  return reclaimed;
}

export async function claimNextDeepScanJob(workerId: string): Promise<DeepScanJob | undefined> {
  await reclaimStaleDeepScanJobs();
  for (let i = 0; i < 25; i += 1) {
    const id = await dequeueDeepScan();
    if (!id) return undefined;
    const job = await getDeepScanJob(id);
    if (!job) continue;
    if (job.status === "complete" || job.status === "failed") continue;
    if (job.claimedBy && job.leaseExpiresAt && Date.parse(job.leaseExpiresAt) > Date.now()) {
      await enqueueDeepScan(id);
      continue;
    }
    if ((job.attemptCount ?? 0) >= DEEP_SCAN_MAX_ATTEMPTS) {
      await updateDeepScanStage(id, "FAILED_TERMINAL", "Max attempts exceeded", {
        failureCode: "MAX_ATTEMPTS",
        failureMessage: "Deep scan exceeded retry budget.",
      });
      continue;
    }
    return finalizeDeepScanClaim(job, workerId);
  }
  return undefined;
}

/**
 * Claim a specific deep-scan job (GitHub Actions on-demand path).
 * Losing concurrent workflows exit as alreadyClaimed when another runner won.
 */
export async function claimDeepScanJobById(
  jobId: string,
  workerId: string
): Promise<
  | { ok: true; job: DeepScanJob; alreadyClaimed: boolean }
  | { ok: false; code: "NOT_FOUND" | "TERMINAL" | "CLAIMED_BY_OTHER" | "MAX_ATTEMPTS"; message: string }
> {
  await reclaimStaleDeepScanJobs();
  const job = await getDeepScanJob(jobId);
  if (!job) return { ok: false, code: "NOT_FOUND", message: "Deep-scan job not found." };
  if (
    job.stage === "READY" ||
    job.stage === "COMPLETED" ||
    job.stage === "CANCELLED" ||
    job.stage === "FAILED_TERMINAL"
  ) {
    return { ok: false, code: "TERMINAL", message: `Job is terminal (${job.stage}).` };
  }
  if (job.claimedBy && job.leaseExpiresAt && Date.parse(job.leaseExpiresAt) > Date.now()) {
    if (job.claimedBy === workerId) {
      return { ok: true, job, alreadyClaimed: true };
    }
    return {
      ok: false,
      code: "CLAIMED_BY_OTHER",
      message: "Job already claimed by another worker.",
    };
  }
  if ((job.attemptCount ?? 0) >= DEEP_SCAN_MAX_ATTEMPTS) {
    return { ok: false, code: "MAX_ATTEMPTS", message: "Deep scan exceeded retry budget." };
  }
  const claimed = await finalizeDeepScanClaim(job, workerId);
  return { ok: true, job: claimed, alreadyClaimed: false };
}

async function finalizeDeepScanClaim(job: DeepScanJob, workerId: string): Promise<DeepScanJob> {
  const t = nowIso();
  const claimToken = `claim_${nanoid(16)}`;
  const claimed: DeepScanJob = {
    ...job,
    status: "running",
    stage: "CLAIMED",
    claimedBy: workerId,
    claimToken,
    claimedAt: t,
    heartbeatAt: t,
    leaseExpiresAt: leaseExpiresAt(),
    workerHost: workerId.includes("github-actions")
      ? "github-actions/ubuntu-latest"
      : process.env.WORKER_HOST?.trim() || process.env.HOSTNAME?.trim(),
    workerMode: workerId.includes("github-actions") ? "github_actions_on_demand" : job.workerMode,
    attemptCount: (job.attemptCount ?? 0) + 1,
    updatedAt: t,
    progress: {
      stage: "CLAIMED",
      percent: stagePercent("CLAIMED"),
      detail: `Claimed by ${workerId}`,
      updatedAt: t,
    },
    statusHistory: [
      ...job.statusHistory,
      {
        stage: "CLAIMED",
        at: t,
        detail: `claimed by ${workerId}`,
      },
    ],
  };
  await saveDeepScanJob(claimed);
  await trackDeepScanActive(claimed.id, true);
  return claimed;
}

export async function heartbeatDeepScanJob(
  id: string,
  workerId: string,
  detail?: string,
  claimToken?: string
): Promise<DeepScanJob | undefined> {
  const job = await getDeepScanJob(id);
  if (!job) return undefined;
  assertDeepScanClaim(job, workerId, claimToken ?? job.claimToken);
  const t = nowIso();
  const next: DeepScanJob = {
    ...job,
    heartbeatAt: t,
    leaseExpiresAt: leaseExpiresAt(),
    progress: {
      ...job.progress,
      detail: detail ?? job.progress.detail,
      updatedAt: t,
    },
    statusHistory: [
      ...job.statusHistory,
      { stage: job.stage, at: t, detail: detail ? `lease-extend: ${detail}` : "lease-extend" },
    ],
    updatedAt: t,
  };
  await saveDeepScanJob(next);
  return next;
}

export async function failDeepScanJob(
  id: string,
  code: string,
  message: string,
  options?: { terminal?: boolean }
): Promise<DeepScanJob | undefined> {
  const job = await getDeepScanJob(id);
  if (!job) return undefined;
  const attempts = job.attemptCount ?? 0;
  const terminal =
    options?.terminal === true || attempts >= DEEP_SCAN_MAX_ATTEMPTS || code === "MAX_ATTEMPTS";

  if (terminal) {
    return updateDeepScanStage(id, "FAILED_TERMINAL", message, {
      failureCode: code,
      failureMessage: message,
    });
  }

  const t = nowIso();
  const retryable: DeepScanJob = {
    ...job,
    status: "queued",
    stage: "QUEUED",
    failureCode: code,
    failureMessage: message,
    claimedBy: undefined,
    claimToken: undefined,
    leaseExpiresAt: undefined,
    heartbeatAt: undefined,
    completedAt: undefined,
    progress: {
      stage: "QUEUED",
      percent: 0,
      detail: `Retryable failure: ${message}`,
      updatedAt: t,
    },
    statusHistory: [
      ...job.statusHistory,
      { stage: "FAILED_RETRYABLE", at: t, detail: message },
      { stage: "QUEUED", at: t, detail: "re-queued after retryable failure" },
    ],
    updatedAt: t,
  };
  await saveDeepScanJob(retryable);
  await enqueueDeepScan(id);
  await trackDeepScanActive(id, true);
  return retryable;
}

export async function abandonStaleDeepScanClaims(): Promise<number> {
  // Lightweight recovery: stale claimed jobs are re-queued by claim loop when lease expires.
  const { deepScanQueueDepth } = await import("./atomic-queue");
  return deepScanQueueDepth();
}

export async function deleteDeepScanJob(id: string): Promise<void> {
  await deletePersistentRecord(COLLECTION, id);
}
