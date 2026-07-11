import { nanoid } from "nanoid";
import {
  deletePersistentRecord,
  dequeuePersistentJob,
  enqueuePersistentJob,
  getPersistentRecord,
  requeuePersistentJob,
  setPersistentRecord,
} from "@/lib/store/persistent-store";
import { isWorkerAvailable } from "./worker-instance-store";
import type {
  RepositoryJob,
  RepositoryJobPayload,
  RepositoryJobResult,
  RepositoryJobStatus,
} from "./types";
import {
  JOB_LEASE_MS,
  MAX_JOB_ATTEMPTS,
  STALE_JOB_MS,
} from "./types";

const COLLECTION = "repository_jobs" as const;
const ACTIVE_CLEANUP_PREFIX = "active_cleanup:";

function nowIso(): string {
  return new Date().toISOString();
}

function leaseExpiresAt(): string {
  return new Date(Date.now() + JOB_LEASE_MS).toISOString();
}

function appendStatusHistory(
  job: RepositoryJob,
  status: RepositoryJobStatus,
  detail?: string
): RepositoryJob["statusHistory"] {
  const history = job.statusHistory ?? [];
  return [...history, { status, at: nowIso(), detail }];
}

export function createRepositoryJobId(): string {
  return `repo_job_${nanoid(12)}`;
}

export class WorkerUnavailableError extends Error {
  code = "WORKER_UNAVAILABLE" as const;
  constructor() {
    super("No Docker worker heartbeat detected in the last 30 seconds.");
  }
}

export async function getRepositoryJob(id: string): Promise<RepositoryJob | undefined> {
  return getPersistentRecord<RepositoryJob>(COLLECTION, id);
}

export async function getRepositoryJobByCleanupRunId(
  cleanupRunId: string
): Promise<RepositoryJob | undefined> {
  const index = await getPersistentRecord<string>(COLLECTION, `by_cleanup:${cleanupRunId}`);
  if (!index) return undefined;
  return getRepositoryJob(index);
}

export async function saveRepositoryJob(job: RepositoryJob): Promise<void> {
  job.updatedAt = nowIso();
  await setPersistentRecord(COLLECTION, job.id, job);
  await setPersistentRecord(COLLECTION, `by_cleanup:${job.cleanupRunId}`, job.id);
  if (!["failed", "blocked", "timed_out", "delivered"].includes(job.status)) {
    await setPersistentRecord(COLLECTION, `${ACTIVE_CLEANUP_PREFIX}${job.cleanupRunId}`, job.id);
  } else {
    await deletePersistentRecord(COLLECTION, `${ACTIVE_CLEANUP_PREFIX}${job.cleanupRunId}`);
  }
}

export async function createRepositoryJob(
  payload: RepositoryJobPayload,
  options?: { skipWorkerCheck?: boolean }
): Promise<RepositoryJob> {
  const existing = await getRepositoryJobByCleanupRunId(payload.cleanupRunId);
  if (existing && !["failed", "blocked", "timed_out", "delivered"].includes(existing.status)) {
    return existing;
  }

  if (!options?.skipWorkerCheck && !(await isWorkerAvailable())) {
    throw new WorkerUnavailableError();
  }

  const t = nowIso();
  const job: RepositoryJob = {
    id: createRepositoryJobId(),
    cleanupRunId: payload.cleanupRunId,
    repositoryOwner: payload.repositoryOwner,
    repositoryName: payload.repositoryName,
    branch: payload.branch,
    baseCommitSha: payload.baseCommitSha,
    status: "queued",
    attemptCount: 0,
    payload,
    statusHistory: [{ status: "queued", at: t }],
    createdAt: t,
    updatedAt: t,
  };
  await saveRepositoryJob(job);
  await enqueuePersistentJob(job.id);
  return job;
}

export async function updateRepositoryJob(
  id: string,
  patch: Partial<RepositoryJob> & { status?: RepositoryJobStatus; progressDetail?: string }
): Promise<RepositoryJob | undefined> {
  const job = await getRepositoryJob(id);
  if (!job) return undefined;
  const { progressDetail, ...rest } = patch;
  const next: RepositoryJob = {
    ...job,
    ...rest,
    updatedAt: nowIso(),
    statusHistory:
      patch.status && patch.status !== job.status
        ? appendStatusHistory(job, patch.status, progressDetail)
        : job.statusHistory,
  };
  await saveRepositoryJob(next);
  return next;
}

async function tryClaimJob(jobId: string, workerId: string): Promise<RepositoryJob | null> {
  const job = await getRepositoryJob(jobId);
  if (!job || job.status !== "queued") return null;

  const attempts = (job.attemptCount ?? 0) + 1;
  if (attempts > MAX_JOB_ATTEMPTS) {
    await updateRepositoryJob(jobId, {
      status: "failed",
      failureCode: "MAX_ATTEMPTS_EXCEEDED",
      failureMessage: `Job exceeded ${MAX_JOB_ATTEMPTS} execution attempts.`,
      completedAt: nowIso(),
    });
    return null;
  }

  const claimed: RepositoryJob = {
    ...job,
    status: "claimed",
    claimedBy: workerId,
    claimedAt: nowIso(),
    heartbeatAt: nowIso(),
    leaseExpiresAt: leaseExpiresAt(),
    startedAt: job.startedAt ?? nowIso(),
    attemptCount: attempts,
    statusHistory: appendStatusHistory(job, "claimed", `claimed by ${workerId}`),
    updatedAt: nowIso(),
  };
  await saveRepositoryJob(claimed);

  const verify = await getRepositoryJob(jobId);
  if (verify?.claimedBy !== workerId || verify.status !== "claimed") {
    return null;
  }
  return verify;
}

export async function claimNextRepositoryJob(workerId: string): Promise<RepositoryJob | null> {
  await recoverStaleRepositoryJobs();

  for (let i = 0; i < 20; i++) {
    const jobId = await dequeuePersistentJob();
    if (!jobId) return null;

    const claimed = await tryClaimJob(jobId, workerId);
    if (claimed) return claimed;

    const job = await getRepositoryJob(jobId);
    if (job?.status === "queued") {
      await requeuePersistentJob(jobId);
    }
  }
  return null;
}

export async function heartbeatRepositoryJob(id: string, workerId: string): Promise<boolean> {
  const job = await getRepositoryJob(id);
  if (!job || job.claimedBy !== workerId) return false;
  if (job.leaseExpiresAt && Date.parse(job.leaseExpiresAt) < Date.now()) {
    return false;
  }
  await updateRepositoryJob(id, {
    heartbeatAt: nowIso(),
    leaseExpiresAt: leaseExpiresAt(),
  });
  return true;
}

export async function completeRepositoryJob(
  id: string,
  workerId: string,
  result: RepositoryJobResult,
  status: RepositoryJobStatus = "ready_for_delivery"
): Promise<RepositoryJob | undefined> {
  const job = await getRepositoryJob(id);
  if (!job || job.claimedBy !== workerId) return undefined;
  return updateRepositoryJob(id, {
    status,
    result,
    completedAt: nowIso(),
    heartbeatAt: nowIso(),
    leaseExpiresAt: undefined,
    progressDetail: "completed",
  });
}

export async function failRepositoryJob(
  id: string,
  workerId: string,
  failureCode: string,
  failureMessage: string
): Promise<RepositoryJob | undefined> {
  const job = await getRepositoryJob(id);
  if (!job || job.claimedBy !== workerId) return undefined;
  return updateRepositoryJob(id, {
    status: "failed",
    failureCode,
    failureMessage,
    completedAt: nowIso(),
    progressDetail: failureMessage,
  });
}

export async function recoverStaleRepositoryJobs(
  staleMs: number = STALE_JOB_MS
): Promise<number> {
  let recovered = 0;
  const activePrefix = `${ACTIVE_CLEANUP_PREFIX}`;
  const headId = await getPersistentRecord<string>(COLLECTION, "queue:head");
  const ids = new Set<string>();
  if (headId) ids.add(headId);

  const queueList = await getPersistentRecord<string[]>(COLLECTION, "queue:list");
  if (queueList) queueList.forEach((id) => ids.add(id));

  for (const cleanupRunId of []) {
    void cleanupRunId;
  }

  const scanIds = [...ids];
  for (const id of scanIds) {
    const job = await getRepositoryJob(id);
    if (!job?.heartbeatAt || !job.claimedBy) continue;
    if (!["claimed", "cloning", "transforming", "validating_patch", "baseline_verify", "patched_verify"].includes(job.status)) {
      continue;
    }
    const leaseExpired =
      job.leaseExpiresAt && Date.parse(job.leaseExpiresAt) < Date.now();
    const heartbeatAge = Date.now() - Date.parse(job.heartbeatAt);
    if (!leaseExpired && heartbeatAge < staleMs) continue;

    const attempts = job.attemptCount ?? 1;
    if (attempts >= MAX_JOB_ATTEMPTS) {
      await updateRepositoryJob(job.id, {
        status: "failed",
        failureCode: "JOB_LEASE_EXPIRED",
        failureMessage: "Worker lease expired after maximum retry attempts.",
        completedAt: nowIso(),
        claimedBy: undefined,
        claimedAt: undefined,
        leaseExpiresAt: undefined,
      });
    } else {
      await updateRepositoryJob(job.id, {
        status: "queued",
        claimedBy: undefined,
        claimedAt: undefined,
        heartbeatAt: undefined,
        leaseExpiresAt: undefined,
        failureCode: "STALE_JOB_RECOVERED",
        failureMessage: "Worker heartbeat expired — job requeued.",
        progressDetail: "requeued after stale lease",
      });
      await enqueuePersistentJob(job.id);
    }
    recovered++;
  }
  return recovered;
}

export async function retryRepositoryJob(cleanupRunId: string): Promise<RepositoryJob | null> {
  const existing = await getRepositoryJobByCleanupRunId(cleanupRunId);
  if (!existing) return null;
  if (!["failed", "blocked", "timed_out"].includes(existing.status)) {
    return existing;
  }
  const t = nowIso();
  const job: RepositoryJob = {
    ...existing,
    status: "queued",
    claimedBy: undefined,
    claimedAt: undefined,
    heartbeatAt: undefined,
    leaseExpiresAt: undefined,
    startedAt: undefined,
    completedAt: undefined,
    failureCode: undefined,
    failureMessage: undefined,
    result: undefined,
    attemptCount: 0,
    statusHistory: [...(existing.statusHistory ?? []), { status: "queued", at: t, detail: "manual retry" }],
    updatedAt: t,
  };
  await saveRepositoryJob(job);
  await enqueuePersistentJob(job.id);
  return job;
}

export async function deleteRepositoryJob(id: string): Promise<void> {
  await deletePersistentRecord(COLLECTION, id);
}
