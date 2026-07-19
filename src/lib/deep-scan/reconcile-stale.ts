import { getPersistentRecord, setPersistentRecord } from "@/lib/store/persistent-store";
import { listDeepScanQueueIds, replaceDeepScanQueueIds } from "./atomic-queue";
import { trackDeepScanActive } from "./capacity";
import {
  getDeepScanJob,
  reclaimStaleDeepScanJobs,
  updateDeepScanStage,
} from "./job-store";
import type { DeepScanJob, DeepScanStage } from "./types";
import {
  correlateWorkflowRunForJob,
  dispatchQueuedDeepScanJob,
  DISPATCH_STARTUP_GRACE_MS,
  MAX_DISPATCH_ATTEMPTS,
  needsDispatchRecovery,
  readDispatchMeta,
} from "./dispatch-queued-job";

const COLLECTION = "deep_scan_jobs" as const;
const ACTIVE_INDEX = "active:index";
const REPORT_KEY = "stale_queue_reconciliation_report";

/** Absolute ceiling — jobs older than this without execution become terminal. */
const STALE_QUEUED_HARD_MS = 60 * 60 * 1000;

export type ReconcileTransition =
  | "WORKER_STALLED"
  | "CANCELLED"
  | "SUPERSEDED"
  | "FAILED"
  | "REDISPATCH"
  | "ATTACH_WORKFLOW"
  | "KEEP"
  | "ALREADY_TERMINAL";

export interface DeepScanJobInspection {
  jobId: string;
  repository: string | null;
  tenantOrOwner: string | null;
  taskType: "deep_scan";
  createdAt: string | null;
  updatedAt: string | null;
  lastActivityAt: string | null;
  currentStage: DeepScanStage | "MISSING";
  status: DeepScanJob["status"] | "missing";
  workflowRunId: string | null;
  workflowRunExists: boolean | null;
  leaseStatus: "none" | "active" | "expired";
  belongsToCompletedScan: boolean;
  legacyIncidentJob: boolean;
  safeRecommendedTransition: ReconcileTransition;
  transitionApplied: ReconcileTransition | null;
  reason: string;
}

export interface StaleQueueReconciliationReport {
  checkedAt: string;
  queueDepthBefore: number;
  queueDepthAfter: number;
  activeJobsBefore: number;
  activeJobsAfter: number;
  staleJobsReconciled: number;
  completedEvidencePreserved: boolean;
  inspections: DeepScanJobInspection[];
}

function isTerminalStage(stage: DeepScanStage): boolean {
  return (
    stage === "READY" ||
    stage === "COMPLETED" ||
    stage === "CANCELLED" ||
    stage === "FAILED" ||
    stage === "FAILED_TERMINAL" ||
    stage === "FAILED_RETRYABLE" ||
    stage === "WORKER_STALLED"
  );
}

function isActiveCapacityJob(job: DeepScanJob): boolean {
  if (job.status === "complete" || job.status === "failed") return false;
  if (isTerminalStage(job.stage) && job.stage !== "FAILED_RETRYABLE") return false;
  // FAILED_RETRYABLE may briefly exist before re-queue; treat RETRY_PENDING QUEUED as active.
  if (job.stage === "FAILED_RETRYABLE") return false;
  return job.status === "queued" || job.status === "running";
}

function leaseStatus(job: DeepScanJob): "none" | "active" | "expired" {
  if (!job.leaseExpiresAt) return "none";
  return Date.parse(job.leaseExpiresAt) > Date.now() ? "active" : "expired";
}

function repositoryOf(job: DeepScanJob): string | null {
  if (job.repositoryFullName) return job.repositoryFullName;
  if (job.repositoryOwner && job.repositoryName) {
    return `${job.repositoryOwner}/${job.repositoryName}`;
  }
  const url = job.request.repoUrl ?? job.repositoryUrl;
  if (!url) return null;
  try {
    const parts = new URL(url).pathname.replace(/^\//, "").split("/").filter(Boolean);
    if (parts.length >= 2) return `${parts[0]}/${parts[1]!.replace(/\.git$/, "")}`;
  } catch {
    return null;
  }
  return null;
}

function isLegacyIncident(job: DeepScanJob): boolean {
  if (job.workerMode === "always_on" || job.workerMode === "unset") return true;
  if (!job.workflowRunId && (job.stage === "QUEUED" || job.stage === "DISPATCHING")) {
    return (job.attemptCount ?? 0) === 0 && !job.dispatchedAt;
  }
  return Boolean(job.failureCode?.includes("LEGACY") || job.failureCode?.includes("INCIDENT"));
}

async function workflowRunExists(workflowRunId?: string): Promise<boolean | null> {
  if (!workflowRunId) return false;
  const id = Number(workflowRunId);
  if (!Number.isFinite(id)) return null;
  try {
    const res = await fetch(`https://api.github.com/repos/smokychain22/agentPass/actions/runs/${id}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "RepoDiet-stale-queue-reconcile",
      },
    });
    if (res.status === 404) return false;
    if (!res.ok) return null;
    const body = (await res.json()) as { status?: string; conclusion?: string | null };
    if (body.status === "in_progress" || body.status === "queued" || body.status === "waiting") {
      return true;
    }
    return false;
  } catch {
    return null;
  }
}

function recommendTransition(
  job: DeepScanJob,
  liveWorkflow: boolean | null
): { transition: ReconcileTransition; reason: string } {
  if (isTerminalStage(job.stage) && job.stage !== "FAILED_RETRYABLE") {
    return { transition: "ALREADY_TERMINAL", reason: `Already terminal (${job.stage}).` };
  }
  if (job.stage === "READY" || job.stage === "COMPLETED" || job.scanId || job.findingsId) {
    if (job.stage === "READY" || job.stage === "COMPLETED") {
      return {
        transition: "KEEP",
        reason: "Completed scan evidence — do not mutate.",
      };
    }
  }

  const lease = leaseStatus(job);
  const ageMs = Date.now() - Date.parse(job.createdAt);
  const inactive =
    !job.lastActivityAt || Date.now() - Date.parse(job.lastActivityAt) > DEEP_SCAN_LEASE_LIKE_MS();
  const meta = readDispatchMeta(job);

  // Claimed / running with expired lease and no live workflow → WORKER_STALLED
  if (job.claimedBy && lease === "expired" && liveWorkflow !== true) {
    return {
      transition: "WORKER_STALLED",
      reason: "Expired lease, no live GitHub Actions workflow, not actively processing.",
    };
  }

  // Live workflow + active lease → keep
  if (liveWorkflow === true && lease === "active") {
    return {
      transition: "KEEP",
      reason: "Live workflow run exists with active lease.",
    };
  }

  // Dispatched with known run id that still exists → keep / attach
  if (job.workflowRunId && liveWorkflow === true) {
    return {
      transition: "KEEP",
      reason: "Live workflow run attached.",
    };
  }

  // Undispatched / no lease past grace → try attach then redispatch
  if (
    !job.workflowRunId &&
    lease === "none" &&
    (job.stage === "QUEUED" ||
      job.stage === "DISPATCHING" ||
      job.stage === "DISPATCHED" ||
      job.stage === "WAITING_FOR_RUNNER" ||
      job.stage === "FAILED_RETRYABLE" ||
      meta.dispatchState === "RETRY_PENDING" ||
      meta.dispatchState === "NOT_DISPATCHED")
  ) {
    if (ageMs < DISPATCH_STARTUP_GRACE_MS && meta.dispatchAttempt > 0) {
      return {
        transition: "KEEP",
        reason: "Within dispatch startup grace — awaiting workflow correlation.",
      };
    }
    if (ageMs < DISPATCH_STARTUP_GRACE_MS && meta.dispatchAttempt === 0 && !job.dispatchedAt) {
      return {
        transition: "REDISPATCH",
        reason: "Accepted job has no dispatch attempt — dispatch now.",
      };
    }
    if (meta.dispatchAttempt >= MAX_DISPATCH_ATTEMPTS || ageMs >= STALE_QUEUED_HARD_MS) {
      return {
        transition: "FAILED",
        reason: `Dispatch recovery exhausted (attempts=${meta.dispatchAttempt}, ageMs=${ageMs}).`,
      };
    }
    if (needsDispatchRecovery(job) || meta.dispatchAttempt === 0) {
      return {
        transition: "REDISPATCH",
        reason:
          "QUEUED with no workflowRunId and no lease past grace — redispatch with backoff.",
      };
    }
  }

  // Running stages with no lease and no live workflow → FAILED
  if (
    job.status === "running" &&
    lease !== "active" &&
    liveWorkflow !== true &&
    inactive
  ) {
    return {
      transition: "FAILED",
      reason: "Running stage without active lease or live workflow.",
    };
  }

  if (lease === "active" && job.claimedBy) {
    return {
      transition: "KEEP",
      reason: "Active lease — worker may still be processing.",
    };
  }

  if (ageMs < DISPATCH_STARTUP_GRACE_MS) {
    return {
      transition: "KEEP",
      reason: "Recently enqueued — within dispatch startup grace.",
    };
  }

  return {
    transition: "REDISPATCH",
    reason: "No live worker activity; attempt durable redispatch before terminal failure.",
  };
}

function DEEP_SCAN_LEASE_LIKE_MS(): number {
  return 120_000;
}

async function applyTransition(
  job: DeepScanJob,
  transition: ReconcileTransition,
  reason: string
): Promise<ReconcileTransition | null> {
  if (transition === "KEEP" || transition === "ALREADY_TERMINAL") return null;

  if (transition === "ATTACH_WORKFLOW") {
    const correlated = await correlateWorkflowRunForJob(job, { maxWaitMs: 3_000 });
    return correlated.matched ? "ATTACH_WORKFLOW" : null;
  }

  if (transition === "REDISPATCH") {
    // First try to attach an existing run (idempotent correlation).
    const correlated = await correlateWorkflowRunForJob(job, { maxWaitMs: 2_000 });
    if (correlated.matched) {
      return "ATTACH_WORKFLOW";
    }
    await dispatchQueuedDeepScanJob({
      jobId: job.id,
      requestId: `reconcile_${job.id}`,
      tenantId: job.tenantId ?? job.request.tenantId,
      force: true,
    });
    return "REDISPATCH";
  }

  if (transition === "WORKER_STALLED") {
    await updateDeepScanStage(job.id, "WORKER_STALLED", reason, {
      failureCode: "WORKER_STALLED",
      failureMessage: reason,
      claimedBy: undefined,
      claimToken: undefined,
      progressTokenHash: undefined,
      leaseExpiresAt: undefined,
      heartbeatAt: undefined,
    });
    return "WORKER_STALLED";
  }

  if (transition === "FAILED") {
    await updateDeepScanStage(job.id, "FAILED_TERMINAL", reason, {
      failureCode: "STALE_QUEUE_FAILED",
      failureMessage: reason,
      claimedBy: undefined,
      claimToken: undefined,
      progressTokenHash: undefined,
      leaseExpiresAt: undefined,
      resultSummary: {
        ...(job.resultSummary ?? {}),
        dispatch: {
          ...((job.resultSummary?.dispatch as Record<string, unknown>) ?? {}),
          dispatchState: "FAILED_TERMINAL",
          lastDispatchError: reason,
        },
      },
    });
    return "FAILED";
  }

  // SUPERSEDED and CANCELLED both land on CANCELLED with structured reason codes.
  const failureCode =
    transition === "SUPERSEDED" ? "SUPERSEDED_STALE_QUEUE" : "CANCELLED_STALE_QUEUE";
  await updateDeepScanStage(job.id, "CANCELLED", reason, {
    failureCode,
    failureMessage: reason,
    claimedBy: undefined,
    claimToken: undefined,
    progressTokenHash: undefined,
    leaseExpiresAt: undefined,
    workerMode: job.workerMode ?? "github_actions_on_demand",
  });
  return transition === "SUPERSEDED" ? "SUPERSEDED" : "CANCELLED";
}

async function inspectJob(jobId: string): Promise<DeepScanJobInspection> {
  const job = await getDeepScanJob(jobId);
  if (!job) {
    return {
      jobId,
      repository: null,
      tenantOrOwner: null,
      taskType: "deep_scan",
      createdAt: null,
      updatedAt: null,
      lastActivityAt: null,
      currentStage: "MISSING",
      status: "missing",
      workflowRunId: null,
      workflowRunExists: false,
      leaseStatus: "none",
      belongsToCompletedScan: false,
      legacyIncidentJob: true,
      safeRecommendedTransition: "SUPERSEDED",
      transitionApplied: null,
      reason: "Queue/index entry has no job record — drop from queue capacity.",
    };
  }

  const liveWorkflow = await workflowRunExists(job.workflowRunId);
  const recommendation = recommendTransition(job, liveWorkflow);
  const belongsToCompletedScan =
    job.stage === "READY" ||
    job.stage === "COMPLETED" ||
    Boolean(job.scanId && (job.status === "complete" || job.findingsId));

  return {
    jobId: job.id,
    repository: repositoryOf(job),
    tenantOrOwner: job.tenantId ?? job.request.tenantId ?? job.repositoryOwner ?? null,
    taskType: "deep_scan",
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    lastActivityAt: job.lastActivityAt ?? job.heartbeatAt ?? job.progress?.updatedAt ?? null,
    currentStage: job.stage,
    status: job.status,
    workflowRunId: job.workflowRunId ?? null,
    workflowRunExists: liveWorkflow,
    leaseStatus: leaseStatus(job),
    belongsToCompletedScan,
    legacyIncidentJob: isLegacyIncident(job),
    safeRecommendedTransition: recommendation.transition,
    transitionApplied: null,
    reason: recommendation.reason,
  };
}

export async function reconcileStaleDeepScanQueue(options?: {
  apply?: boolean;
}): Promise<StaleQueueReconciliationReport> {
  const apply = options?.apply !== false;
  const checkedAt = new Date().toISOString();

  // First pass: existing lease reclaim for github_actions claimed jobs.
  if (apply) {
    await reclaimStaleDeepScanJobs();
  }

  const activeIndex =
    (await getPersistentRecord<string[]>(COLLECTION, ACTIVE_INDEX)) ?? [];
  const queueIds = await listDeepScanQueueIds();
  const allIds = Array.from(new Set([...activeIndex, ...queueIds]));

  const queueDepthBefore = queueIds.length;
  let activeJobsBefore = 0;
  for (const id of activeIndex) {
    const job = await getDeepScanJob(id);
    if (job && isActiveCapacityJob(job)) activeJobsBefore += 1;
  }

  const inspections: DeepScanJobInspection[] = [];
  let staleJobsReconciled = 0;
  let completedEvidencePreserved = true;

  for (const jobId of allIds) {
    const inspection = await inspectJob(jobId);
    // Re-read after reclaim may have already stalled some jobs.
    const job = await getDeepScanJob(jobId);
    if (job && isTerminalStage(job.stage) && job.stage !== "FAILED_RETRYABLE" &&
        inspection.safeRecommendedTransition !== "KEEP" &&
        inspection.safeRecommendedTransition !== "REDISPATCH") {
      inspection.currentStage = job.stage;
      inspection.status = job.status;
      inspection.safeRecommendedTransition = "ALREADY_TERMINAL";
      inspection.reason = `Already terminal after lease reclaim (${job.stage}).`;
      if (
        job.stage === "WORKER_STALLED" ||
        job.stage === "CANCELLED" ||
        job.stage === "FAILED_TERMINAL"
      ) {
        if (activeIndex.includes(jobId)) staleJobsReconciled += 1;
      }
      inspections.push(inspection);
      continue;
    }

    if (
      inspection.belongsToCompletedScan &&
      (inspection.currentStage === "READY" || inspection.currentStage === "COMPLETED")
    ) {
      completedEvidencePreserved = true;
      inspection.safeRecommendedTransition = "KEEP";
      inspection.reason = "Completed scan evidence preserved.";
      inspections.push(inspection);
      continue;
    }

    if (
      apply &&
      inspection.safeRecommendedTransition !== "KEEP" &&
      inspection.safeRecommendedTransition !== "ALREADY_TERMINAL"
    ) {
      if (!job) {
        await trackDeepScanActive(jobId, false);
        inspection.transitionApplied = "SUPERSEDED";
        staleJobsReconciled += 1;
      } else {
        const applied = await applyTransition(
          job,
          inspection.safeRecommendedTransition,
          inspection.reason
        );
        inspection.transitionApplied = applied;
        if (applied) staleJobsReconciled += 1;
      }
    }

    inspections.push(inspection);
  }

  // Drain terminal / missing IDs from the Redis/local queue without deleting job records.
  const keepQueue: string[] = [];
  for (const id of queueIds) {
    const job = await getDeepScanJob(id);
    if (!job) continue;
    if (isTerminalStage(job.stage) && job.stage !== "FAILED_RETRYABLE") continue;
    if (job.status === "complete" || job.status === "failed") {
      // Retry-pending QUEUED after FAILED_RETRYABLE uses status queued.
      if (job.stage !== "QUEUED") continue;
    }
    keepQueue.push(id);
  }
  if (apply) {
    await replaceDeepScanQueueIds(keepQueue);
    const nextActive: string[] = [];
    for (const id of Array.from(new Set(activeIndex))) {
      const job = await getDeepScanJob(id);
      if (job && isActiveCapacityJob(job)) nextActive.push(id);
    }
    await setPersistentRecord(COLLECTION, ACTIVE_INDEX, nextActive);
  }

  const activeIndexAfter =
    (await getPersistentRecord<string[]>(COLLECTION, ACTIVE_INDEX)) ?? [];
  let activeJobsAfter = 0;
  for (const id of activeIndexAfter) {
    const job = await getDeepScanJob(id);
    if (job && isActiveCapacityJob(job)) activeJobsAfter += 1;
  }
  const queueDepthAfter = apply ? keepQueue.length : queueDepthBefore;

  const report: StaleQueueReconciliationReport = {
    checkedAt,
    queueDepthBefore,
    queueDepthAfter,
    activeJobsBefore,
    activeJobsAfter,
    staleJobsReconciled,
    completedEvidencePreserved,
    inspections,
  };

  await setPersistentRecord(COLLECTION, REPORT_KEY, report);
  return report;
}

export async function getLastStaleQueueReconciliationReport(): Promise<
  StaleQueueReconciliationReport | undefined
> {
  return getPersistentRecord<StaleQueueReconciliationReport>(COLLECTION, REPORT_KEY);
}
