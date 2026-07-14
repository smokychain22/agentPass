import { nanoid } from "nanoid";
import { durableNow, deleteDurableRecord, getDurableRecord, setDurableRecord } from "@/lib/store/durable-store";
import type { AspJobRecord } from "./types";

function jobKey(jobId: string): string {
  return jobId;
}

function orderKey(okxOrderId: string): string {
  return `order:${okxOrderId}`;
}

export function newAspJobId(): string {
  return `job_${nanoid(12)}`;
}

export async function saveAspJob(job: AspJobRecord): Promise<void> {
  await setDurableRecord("asp_jobs", jobKey(job.id), job);
  await setDurableRecord("asp_jobs", orderKey(job.okxOrderId), { jobId: job.id });
}

export async function getAspJob(jobId: string): Promise<AspJobRecord | undefined> {
  return getDurableRecord<AspJobRecord>("asp_jobs", jobKey(jobId));
}

export async function getAspJobIdByOrderId(okxOrderId: string): Promise<string | undefined> {
  const ref = await getDurableRecord<{ jobId: string }>("asp_jobs", orderKey(okxOrderId));
  return ref?.jobId;
}

export async function getAspJobByOrderId(okxOrderId: string): Promise<AspJobRecord | undefined> {
  const jobId = await getAspJobIdByOrderId(okxOrderId);
  if (!jobId) return undefined;
  return getAspJob(jobId);
}

export async function updateAspJob(
  jobId: string,
  patch: Partial<AspJobRecord>
): Promise<AspJobRecord | undefined> {
  const existing = await getAspJob(jobId);
  if (!existing) return undefined;
  const updated: AspJobRecord = {
    ...existing,
    ...patch,
    id: existing.id,
    okxOrderId: existing.okxOrderId,
    updatedAt: durableNow(),
  };
  await saveAspJob(updated);
  return updated;
}

export interface AspRepositoryInstallation {
  installationId: number;
  repositoryFullName: string;
  authorizedAt: string;
}

function aspInstallationKey(repositoryFullName: string): string {
  return `install:${repositoryFullName.toLowerCase()}`;
}

export async function saveAspRepositoryInstallation(
  binding: AspRepositoryInstallation
): Promise<void> {
  await setDurableRecord("asp_jobs", aspInstallationKey(binding.repositoryFullName), binding);
}

export async function getAspRepositoryInstallation(
  repositoryFullName: string
): Promise<AspRepositoryInstallation | undefined> {
  return getDurableRecord<AspRepositoryInstallation>(
    "asp_jobs",
    aspInstallationKey(repositoryFullName)
  );
}

export async function deleteAspRepositoryInstallation(repositoryFullName: string): Promise<void> {
  await deleteDurableRecord("asp_jobs", aspInstallationKey(repositoryFullName));
}
