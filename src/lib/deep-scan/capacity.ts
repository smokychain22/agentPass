import { getPersistentRecord, setPersistentRecord } from "@/lib/store/persistent-store";
import { PUBLIC_CAPACITY_LIMITS } from "@/lib/product/capacity-limits";
import { deepScanQueueDepth } from "./atomic-queue";
import type { DeepScanJob } from "./types";

const COLLECTION = "deep_scan_jobs" as const;
const ACTIVE_INDEX = "active:index";

export interface DeepScanCapacitySnapshot {
  queueDepth: number;
  activeJobs: number;
  activeByTenant: Record<string, number>;
  globalLimit: number;
  perTenantLimit: number;
  oldestQueuedTaskAgeSeconds: number | null;
  atGlobalCapacity: boolean;
  tenantAtCapacity: boolean;
}

function isActiveJob(job: DeepScanJob): boolean {
  if (job.status === "complete" || job.status === "failed") return false;
  if (job.stage === "READY" || job.stage === "COMPLETED" || job.stage === "CANCELLED") return false;
  if (job.stage === "FAILED" || job.stage === "FAILED_TERMINAL" || job.stage === "FAILED_RETRYABLE") {
    return false;
  }
  return job.status === "queued" || job.status === "running";
}

export async function getDeepScanCapacitySnapshot(
  tenantId?: string
): Promise<DeepScanCapacitySnapshot> {
  const queueDepth = await deepScanQueueDepth();
  const activeIndex = (await getPersistentRecord<string[]>(COLLECTION, ACTIVE_INDEX)) ?? [];
  const ids = Array.from(new Set(activeIndex));
  const activeByTenant: Record<string, number> = {};
  let activeJobs = 0;
  let oldestQueuedMs: number | null = null;
  const now = Date.now();

  for (const id of ids) {
    const job = await getPersistentRecord<DeepScanJob>(COLLECTION, id);
    if (!job || !isActiveJob(job)) continue;
    activeJobs += 1;
    const tid = job.tenantId ?? job.request.tenantId ?? "anonymous_public_readonly";
    activeByTenant[tid] = (activeByTenant[tid] ?? 0) + 1;
    if (job.stage === "QUEUED" || job.status === "queued") {
      const age = now - Date.parse(job.createdAt);
      if (Number.isFinite(age) && (oldestQueuedMs === null || age > oldestQueuedMs)) {
        oldestQueuedMs = age;
      }
    }
  }

  const tenantActive = tenantId ? activeByTenant[tenantId] ?? 0 : 0;
  return {
    queueDepth,
    activeJobs,
    activeByTenant,
    globalLimit: PUBLIC_CAPACITY_LIMITS.maxConcurrentDeepScansGlobal,
    perTenantLimit: PUBLIC_CAPACITY_LIMITS.maxConcurrentDeepScansPerTenant,
    oldestQueuedTaskAgeSeconds:
      oldestQueuedMs === null ? null : Math.max(0, Math.floor(oldestQueuedMs / 1000)),
    atGlobalCapacity: activeJobs >= PUBLIC_CAPACITY_LIMITS.maxConcurrentDeepScansGlobal,
    tenantAtCapacity: tenantActive >= PUBLIC_CAPACITY_LIMITS.maxConcurrentDeepScansPerTenant,
  };
}

export async function trackDeepScanActive(jobId: string, active: boolean): Promise<void> {
  const index = (await getPersistentRecord<string[]>(COLLECTION, ACTIVE_INDEX)) ?? [];
  const next = active
    ? Array.from(new Set([...index, jobId]))
    : index.filter((id) => id !== jobId);
  await setPersistentRecord(COLLECTION, ACTIVE_INDEX, next);
}

/** Honest capacity response — never 504, never silent drop. */
export function capacityQueuedResponse(input: {
  taskId: string;
  statusUrl: string;
  queuePosition: number;
  reason: "GLOBAL" | "TENANT";
}) {
  return {
    status: "QUEUED" as const,
    code: "CAPACITY_LIMIT" as const,
    retryable: true,
    taskId: input.taskId,
    statusUrl: input.statusUrl,
    queuePosition: input.queuePosition,
    message:
      input.reason === "TENANT"
        ? "Tenant deep-scan concurrency limit reached. Job is queued."
        : "Global deep-scan capacity reached. Job is queued.",
    requiredAction: "WAIT_FOR_CAPACITY" as const,
  };
}
