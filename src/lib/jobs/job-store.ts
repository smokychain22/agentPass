import {
  durableId,
  durableNow,
  getDurableRecord,
  setDurableRecord,
} from "@/lib/store/durable-store";
import type { RepoDietJob } from "./types";

const memoryJobs = new Map<string, RepoDietJob>();

async function persistJob(job: RepoDietJob): Promise<void> {
  memoryJobs.set(job.id, job);
  await setDurableRecord("jobs", job.id, job);
}

export function createJobId(type: RepoDietJob["type"]): string {
  return durableId(`job_${type}`);
}

export async function getJob(jobId: string): Promise<RepoDietJob | undefined> {
  const fromMemory = memoryJobs.get(jobId);
  if (fromMemory) return fromMemory;
  const fromStore = await getDurableRecord<RepoDietJob>("jobs", jobId);
  if (fromStore) memoryJobs.set(jobId, fromStore);
  return fromStore;
}

export async function updateJob(
  jobId: string,
  patch: Partial<RepoDietJob> & { stage?: string; status?: RepoDietJob["status"] }
): Promise<RepoDietJob> {
  const existing = await getJob(jobId);
  if (!existing) {
    throw new Error(`Job not found: ${jobId}`);
  }
  const updated = {
    ...existing,
    ...patch,
    updatedAt: durableNow(),
  } as RepoDietJob;
  await persistJob(updated);
  return updated;
}

export async function saveJob(job: RepoDietJob): Promise<RepoDietJob> {
  await persistJob(job);
  return job;
}

export async function listJobsForOwner(ownerKey: string, limit = 20): Promise<RepoDietJob[]> {
  // Redis has no full scan in hot path — memory + per-id lookups only for now.
  return [...memoryJobs.values()]
    .filter((job) => job.ownerKey === ownerKey)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export function assertJobOwner(job: RepoDietJob, ownerKey: string): void {
  if (job.ownerKey !== ownerKey) {
    throw new Error("Unauthorized job access.");
  }
}
