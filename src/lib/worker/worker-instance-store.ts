import { nanoid } from "nanoid";
import {
  getPersistentRecord,
  setPersistentRecord,
} from "@/lib/store/persistent-store";
import type { WorkerInstance, WorkerInstanceStatus } from "./types";
import { WORKER_AVAILABILITY_WINDOW_MS } from "./types";

const COLLECTION = "worker_instances" as const;
const ONLINE_INDEX = "online:latest";

function nowIso(): string {
  return new Date().toISOString();
}

export function createWorkerId(): string {
  return `worker_${nanoid(12)}`;
}

export async function getWorkerInstance(id: string): Promise<WorkerInstance | undefined> {
  return getPersistentRecord<WorkerInstance>(COLLECTION, id);
}

export async function saveWorkerInstance(instance: WorkerInstance): Promise<void> {
  instance.heartbeatAt = nowIso();
  await setPersistentRecord(COLLECTION, instance.id, instance);
  await setPersistentRecord(COLLECTION, ONLINE_INDEX, instance.id);
}

export async function registerWorkerInstance(input: {
  id?: string;
  version?: string;
  hostname?: string;
  gitVersion?: string;
  nodeVersion?: string;
  npmVersion?: string;
}): Promise<WorkerInstance> {
  const t = nowIso();
  const instance: WorkerInstance = {
    id: input.id?.trim() || createWorkerId(),
    version: input.version?.trim() || process.env.npm_package_version || "unknown",
    hostname: input.hostname?.trim() || "unknown",
    status: "online",
    gitVersion: input.gitVersion,
    nodeVersion: input.nodeVersion,
    npmVersion: input.npmVersion,
    startedAt: t,
    heartbeatAt: t,
    completedJobs: 0,
    failedJobs: 0,
  };
  await saveWorkerInstance(instance);
  return instance;
}

export async function heartbeatWorkerInstance(
  id: string,
  patch: Partial<Pick<WorkerInstance, "status" | "currentJobId" | "completedJobs" | "failedJobs">>
): Promise<WorkerInstance | undefined> {
  const existing = await getWorkerInstance(id);
  if (!existing) return undefined;
  const next: WorkerInstance = {
    ...existing,
    ...patch,
    heartbeatAt: nowIso(),
    status: patch.status ?? existing.status,
  };
  await saveWorkerInstance(next);
  return next;
}

export async function getLatestWorkerHeartbeat(): Promise<WorkerInstance | undefined> {
  const latestId = await getPersistentRecord<string>(COLLECTION, ONLINE_INDEX);
  if (!latestId) return undefined;
  return getWorkerInstance(latestId);
}

export function isWorkerRecentlyOnline(instance: WorkerInstance | undefined): boolean {
  if (!instance) return false;
  if (!["online", "busy"].includes(instance.status)) return false;
  const age = Date.now() - Date.parse(instance.heartbeatAt);
  return age <= WORKER_AVAILABILITY_WINDOW_MS;
}

export async function isWorkerAvailable(): Promise<boolean> {
  const latest = await getLatestWorkerHeartbeat();
  return isWorkerRecentlyOnline(latest);
}

export async function setWorkerStatus(
  id: string,
  status: WorkerInstanceStatus,
  currentJobId?: string
): Promise<void> {
  await heartbeatWorkerInstance(id, { status, currentJobId });
}
