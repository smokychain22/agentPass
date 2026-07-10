import {
  durableId,
  durableNow,
  getDurableRecord,
  setDurableRecord,
  withDurableDb,
} from "@/lib/store/durable-store";
import type { RepoDietJob } from "./types";

const memoryJobs = new Map<string, RepoDietJob>();

function persistJob(job: RepoDietJob): void {
  memoryJobs.set(job.id, job);
  setDurableRecord("jobs", job.id, job);
}

export function createJobId(type: RepoDietJob["type"]): string {
  return durableId(`job_${type}`);
}

export function getJob(jobId: string): RepoDietJob | undefined {
  const fromMemory = memoryJobs.get(jobId);
  if (fromMemory) return fromMemory;
  const fromDisk = getDurableRecord<RepoDietJob>("jobs", jobId);
  if (fromDisk) memoryJobs.set(jobId, fromDisk);
  return fromDisk;
}

export function updateJob(
  jobId: string,
  patch: Partial<RepoDietJob> & { stage?: string; status?: RepoDietJob["status"] }
): RepoDietJob {
  const existing = getJob(jobId);
  if (!existing) {
    throw new Error(`Job not found: ${jobId}`);
  }
  const updated = {
    ...existing,
    ...patch,
    updatedAt: durableNow(),
  } as RepoDietJob;
  persistJob(updated);
  return updated;
}

export function saveJob(job: RepoDietJob): RepoDietJob {
  persistJob(job);
  return job;
}

export async function listJobsForOwner(ownerKey: string, limit = 20): Promise<RepoDietJob[]> {
  return withDurableDb((db) => {
    return Object.values(db.jobs)
      .filter((j): j is RepoDietJob => {
        return typeof j === "object" && j !== null && (j as RepoDietJob).ownerKey === ownerKey;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  });
}

export function assertJobOwner(job: RepoDietJob, ownerKey: string): void {
  if (job.ownerKey !== ownerKey) {
    throw new Error("Unauthorized job access.");
  }
}
