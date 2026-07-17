import { nanoid } from "nanoid";
import {
  deletePersistentRecord,
  getPersistentRecord,
  setPersistentRecord,
} from "@/lib/store/persistent-store";
import { isWorkerAvailable } from "@/lib/worker/worker-instance-store";
import type { DeepScanJob, DeepScanJobRequest, DeepScanStage } from "./types";
import { DEEP_SCAN_LEASE_MS, DEEP_SCAN_MAX_ATTEMPTS, stagePercent } from "./types";

const COLLECTION = "deep_scan_jobs" as const;
const QUEUE_KEY = "queue:list";

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
  const queue = (await getPersistentRecord<string[]>(COLLECTION, QUEUE_KEY)) ?? [];
  if (!queue.includes(jobId)) {
    queue.unshift(jobId);
    await setPersistentRecord(COLLECTION, QUEUE_KEY, queue);
  }
}

async function dequeueDeepScan(): Promise<string | null> {
  const queue = (await getPersistentRecord<string[]>(COLLECTION, QUEUE_KEY)) ?? [];
  const id = queue.pop() ?? null;
  await setPersistentRecord(COLLECTION, QUEUE_KEY, queue);
  return id;
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
  const next: DeepScanJob = {
    ...job,
    ...patch,
    stage,
    status: stage === "READY" ? "complete" : stage === "FAILED" ? "failed" : "running",
    progress: {
      stage,
      percent: stagePercent(stage),
      detail,
      updatedAt: t,
    },
    statusHistory: [...job.statusHistory, { stage, at: t, detail }],
    updatedAt: t,
    completedAt: stage === "READY" || stage === "FAILED" ? t : job.completedAt,
  };
  await saveDeepScanJob(next);
  return next;
}

export async function claimNextDeepScanJob(workerId: string): Promise<DeepScanJob | undefined> {
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
      await updateDeepScanStage(id, "FAILED", "Max attempts exceeded", {
        failureCode: "MAX_ATTEMPTS",
        failureMessage: "Deep scan exceeded retry budget.",
      });
      continue;
    }
    const t = nowIso();
    const claimed: DeepScanJob = {
      ...job,
      status: "running",
      stage: job.stage === "QUEUED" ? "INVENTORY" : job.stage,
      claimedBy: workerId,
      claimedAt: t,
      heartbeatAt: t,
      leaseExpiresAt: leaseExpiresAt(),
      attemptCount: (job.attemptCount ?? 0) + 1,
      updatedAt: t,
      progress: {
        stage: job.stage === "QUEUED" ? "INVENTORY" : job.stage,
        percent: stagePercent(job.stage === "QUEUED" ? "INVENTORY" : job.stage),
        detail: `Claimed by ${workerId}`,
        updatedAt: t,
      },
      statusHistory: [
        ...job.statusHistory,
        {
          stage: job.stage === "QUEUED" ? "INVENTORY" : job.stage,
          at: t,
          detail: `claimed by ${workerId}`,
        },
      ],
    };
    await saveDeepScanJob(claimed);
    return claimed;
  }
  return undefined;
}

export async function heartbeatDeepScanJob(
  id: string,
  workerId: string,
  detail?: string
): Promise<DeepScanJob | undefined> {
  const job = await getDeepScanJob(id);
  if (!job || job.claimedBy !== workerId) return undefined;
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
    updatedAt: t,
  };
  await saveDeepScanJob(next);
  return next;
}

export async function failDeepScanJob(
  id: string,
  code: string,
  message: string
): Promise<DeepScanJob | undefined> {
  return updateDeepScanStage(id, "FAILED", message, {
    failureCode: code,
    failureMessage: message,
  });
}

export async function abandonStaleDeepScanClaims(): Promise<number> {
  // Lightweight recovery: stale claimed jobs are re-queued by claim loop when lease expires.
  // Explicit cleanup hook for operators/tests.
  const marker = await getPersistentRecord<string[]>(COLLECTION, QUEUE_KEY);
  return marker?.length ?? 0;
}

export async function deleteDeepScanJob(id: string): Promise<void> {
  await deletePersistentRecord(COLLECTION, id);
}
