import { nanoid } from "nanoid";
import {
  deletePersistentRecord,
  getPersistentRecord,
  setPersistentRecord,
} from "@/lib/store/persistent-store";
import type {
  RepositoryJob,
  RepositoryJobPayload,
  RepositoryJobResult,
  RepositoryJobStatus,
} from "./types";
import { STALE_JOB_MS } from "./types";

const COLLECTION = "repository_jobs" as const;

function nowIso(): string {
  return new Date().toISOString();
}

export function createRepositoryJobId(): string {
  return `repo_job_${nanoid(12)}`;
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
}

export async function createRepositoryJob(
  payload: RepositoryJobPayload
): Promise<RepositoryJob> {
  const existing = await getRepositoryJobByCleanupRunId(payload.cleanupRunId);
  if (existing && !["failed", "blocked", "timed_out", "delivered"].includes(existing.status)) {
    return existing;
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
    payload,
    createdAt: t,
    updatedAt: t,
  };
  await saveRepositoryJob(job);
  await setPersistentRecord(COLLECTION, "queue:head", job.id);
  return job;
}

export async function updateRepositoryJob(
  id: string,
  patch: Partial<RepositoryJob> & { status?: RepositoryJobStatus }
): Promise<RepositoryJob | undefined> {
  const job = await getRepositoryJob(id);
  if (!job) return undefined;
  const next = { ...job, ...patch, updatedAt: nowIso() };
  await saveRepositoryJob(next);
  return next;
}

export async function claimNextRepositoryJob(workerId: string): Promise<RepositoryJob | null> {
  const headId = await getPersistentRecord<string>(COLLECTION, "queue:head");
  if (!headId) return null;

  const job = await getRepositoryJob(headId);
  if (!job) return null;

  if (job.status !== "queued") {
    return null;
  }

  const claimed: RepositoryJob = {
    ...job,
    status: "claimed",
    claimedBy: workerId,
    claimedAt: nowIso(),
    heartbeatAt: nowIso(),
    startedAt: nowIso(),
  };
  await saveRepositoryJob(claimed);
  return claimed;
}

export async function heartbeatRepositoryJob(id: string, workerId: string): Promise<boolean> {
  const job = await getRepositoryJob(id);
  if (!job || job.claimedBy !== workerId) return false;
  await updateRepositoryJob(id, { heartbeatAt: nowIso() });
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
  });
}

export async function recoverStaleRepositoryJobs(
  staleMs: number = STALE_JOB_MS
): Promise<number> {
  // Local-only recovery scans queue head; production uses Redis SCAN in future.
  const headId = await getPersistentRecord<string>(COLLECTION, "queue:head");
  if (!headId) return 0;
  const job = await getRepositoryJob(headId);
  if (!job?.heartbeatAt || !job.claimedBy) return 0;
  const age = Date.now() - Date.parse(job.heartbeatAt);
  if (age < staleMs) return 0;
  if (["queued", "claimed", "cloning"].includes(job.status)) {
    await updateRepositoryJob(job.id, {
      status: "queued",
      claimedBy: undefined,
      claimedAt: undefined,
      failureCode: "STALE_JOB_RECOVERED",
      failureMessage: "Worker heartbeat expired — job requeued.",
    });
    return 1;
  }
  return 0;
}

export async function deleteRepositoryJob(id: string): Promise<void> {
  await deletePersistentRecord(COLLECTION, id);
}
