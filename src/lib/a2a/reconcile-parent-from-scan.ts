/**
 * Idempotent reconciliation: advance an A2A parent task from its linked deep-scan child.
 *
 * Root-cause fix for stranded parents (historical: task stuck at fetching_repository /
 * DISPATCHED while deep_scan already READY). Polling is a repair path; ingest callback
 * is the primary completion mechanism.
 */

import { getDeepScanJob, getDeepScanJobByA2ATask } from "@/lib/deep-scan/job-store";
import { readDispatchMeta } from "@/lib/deep-scan/dispatch-queued-job";
import { getStoredFindings } from "@/lib/findings/findings-store";
import { durableNow, getDurableRecord, setDurableRecord } from "@/lib/store/durable-store";
import { getA2ATask, saveA2ATask, updateA2ATask } from "./task-store";
import { A2ATaskStateMachine } from "./task-state-machine";
import type { A2ATaskRecord, A2ATaskStatus, InternalRole } from "./types";
import { A2A_TERMINAL_STATUSES } from "./types";
import { logMarketplaceTelemetry } from "@/lib/okx/marketplace-telemetry";

const ANALYSIS_WAIT_STATUSES = new Set<A2ATaskStatus>([
  "submitted",
  "validating",
  "queued",
  "fetching_repository",
  "analyzing",
  "funded",
]);

const READY_CHILD_STAGES = new Set(["READY", "COMPLETED"]);
const FAILED_CHILD_STAGES = new Set([
  "FAILED",
  "FAILED_TERMINAL",
  "FAILED_RETRYABLE",
  "CANCELLED",
  "WORKER_STALLED",
]);

export interface ParentScanReconcileResult {
  taskId: string;
  scanId: string;
  advanced: boolean;
  alreadyAdvanced: boolean;
  previousStatus: A2ATaskStatus;
  newStatus: A2ATaskStatus;
  reason: string;
  task: A2ATaskRecord;
}

export interface TaskAuditEvent {
  id: string;
  taskId: string;
  scanId?: string;
  previousState: A2ATaskStatus;
  newState: A2ATaskStatus;
  reason: string;
  actor: InternalRole | "reconciler" | "ingest_callback" | "status_poll" | "scheduled_job";
  correlation: {
    taskId: string;
    scanId?: string;
    workflowRunId?: string;
    dispatchAttempt?: number;
    stateVersion?: number;
  };
  at: string;
}

async function appendAuditEvent(event: TaskAuditEvent): Promise<void> {
  await setDurableRecord("a2a_task_audit_events", event.id, event);
  const indexKey = `task:${event.taskId}`;
  const existing = (await getDurableRecord<string[]>("a2a_task_audit_index", indexKey)) ?? [];
  if (!existing.includes(event.id)) {
    await setDurableRecord("a2a_task_audit_index", indexKey, [...existing, event.id].slice(-200));
  }
}

function nextStateVersion(task: A2ATaskRecord): number {
  const current =
    typeof (task.result as Record<string, unknown>).stateVersion === "number"
      ? ((task.result as Record<string, unknown>).stateVersion as number)
      : task.transitions.length;
  return current + 1;
}

function alreadyPastAnalysis(task: A2ATaskRecord): boolean {
  if (A2A_TERMINAL_STATUSES.includes(task.status)) return true;
  if (!ANALYSIS_WAIT_STATUSES.has(task.status)) return true;
  if (task.result.findings && typeof task.result.findings === "object") {
    const findings = task.result.findings as Record<string, unknown>;
    if (findings.scanId || findings.summary) return true;
  }
  if (task.scanId) return true;
  return false;
}

/**
 * Authoritative mapping: deep-scan terminal state → parent A2A transition.
 * Safe to call repeatedly — advances exactly once for a given child READY/FAILED.
 */
export async function reconcileParentTaskFromScan(
  taskId: string,
  scanId: string,
  options?: {
    actor?: TaskAuditEvent["actor"];
  }
): Promise<ParentScanReconcileResult | undefined> {
  const actor = options?.actor ?? "reconciler";
  const task = await getA2ATask(taskId);
  if (!task) return undefined;

  const scan =
    (await getDeepScanJob(scanId)) ?? (await getDeepScanJobByA2ATask(taskId));
  if (!scan || scan.id !== scanId) {
    return {
      taskId,
      scanId,
      advanced: false,
      alreadyAdvanced: false,
      previousStatus: task.status,
      newStatus: task.status,
      reason: "scan_not_found_or_mismatched",
      task,
    };
  }

  // Correlation: reject mismatched callbacks.
  if (scan.request.a2aTaskId && scan.request.a2aTaskId !== taskId) {
    return {
      taskId,
      scanId,
      advanced: false,
      alreadyAdvanced: false,
      previousStatus: task.status,
      newStatus: task.status,
      reason: "task_scan_correlation_mismatch",
      task,
    };
  }

  const dispatchMeta = readDispatchMeta(scan);
  const previousStatus = task.status;
  const expectedVersion =
    typeof (task.result as Record<string, unknown>).stateVersion === "number"
      ? ((task.result as Record<string, unknown>).stateVersion as number)
      : task.transitions.length;

  // Optimistic concurrency: re-read and abort if another reconciler already advanced.
  const fresh = await getA2ATask(taskId);
  if (!fresh) return undefined;
  const freshVersion =
    typeof (fresh.result as Record<string, unknown>).stateVersion === "number"
      ? ((fresh.result as Record<string, unknown>).stateVersion as number)
      : fresh.transitions.length;
  if (freshVersion !== expectedVersion) {
    return {
      taskId,
      scanId,
      advanced: false,
      alreadyAdvanced: true,
      previousStatus,
      newStatus: fresh.status,
      reason: "concurrent_state_version_conflict",
      task: fresh,
    };
  }

  if (READY_CHILD_STAGES.has(scan.stage)) {
    if (alreadyPastAnalysis(fresh)) {
      // Still refresh live dispatch metadata without re-emitting analysis transitions.
      const patched = await updateA2ATask(taskId, {
        result: {
          ...fresh.result,
          deepScanJobId: scan.id,
          queueJobId: scan.id,
          dispatchState: dispatchMeta.dispatchState === "DISPATCHED" ? "COMPLETED" : dispatchMeta.dispatchState,
          dispatchAttempt: dispatchMeta.dispatchAttempt,
          workflowRunId: scan.workflowRunId ?? fresh.result.workflowRunId,
          workflowRunUrl: scan.workflowRunUrl ?? fresh.result.workflowRunUrl,
          stateVersion: freshVersion,
          reconciledFromScanAt: durableNow(),
        },
      });
      return {
        taskId,
        scanId,
        advanced: false,
        alreadyAdvanced: true,
        previousStatus,
        newStatus: patched?.status ?? fresh.status,
        reason: "parent_already_past_analysis",
        task: patched ?? fresh,
      };
    }

    let findingsSummary: Record<string, unknown> | undefined;
    const findingsId = scan.findingsId || scan.scanId;
    if (findingsId) {
      try {
        const stored = await getStoredFindings(findingsId);
        if (stored) {
          findingsSummary = {
            scanId: stored.scanId,
            summary: stored.summary,
            riskBuckets: stored.riskBuckets,
            commitSha: stored.repo.commitSha,
            source: "deep_scan_reconcile",
          };
        }
      } catch {
        findingsSummary = {
          scanId: findingsId,
          source: "deep_scan_reconcile",
          note: "findings_id_attached_without_payload",
        };
      }
    }

    const sm = new A2ATaskStateMachine(fresh.transitions);
    // Move out of DISPATCHED/fetching_repository exactly once.
    if (ANALYSIS_WAIT_STATUSES.has(fresh.status) && fresh.status !== "analyzing") {
      sm.emit("analyzing", "repository_analyzer", `reconcile: child ${scan.id} READY`);
    }
    // Analysis complete → quote / awaiting payment for paid cleanup, or awaiting_approval path.
    const nextStatus: A2ATaskStatus =
      fresh.type === "repository.analysis"
        ? "delivery_ready"
        : fresh.input.quoteId || fresh.status === "funded"
          ? "awaiting_approval"
          : "quote_required";
    sm.emit(nextStatus, "orchestrator", `reconcileParentTaskFromScan:${scan.id}:READY`);

    const stateVersion = nextStateVersion(fresh);
    const updated: A2ATaskRecord = {
      ...fresh,
      status: sm.current(),
      scanId: findingsId ?? fresh.scanId,
      repository: {
        ...fresh.repository,
        commitSha:
          (findingsSummary?.commitSha as string | undefined) ??
          scan.sourceCommit ??
          fresh.repository.commitSha,
        branch: scan.branch || fresh.repository.branch,
      },
      result: {
        ...fresh.result,
        deepScanJobId: scan.id,
        queueJobId: scan.id,
        dispatchState: "COMPLETED",
        dispatchAttempt: dispatchMeta.dispatchAttempt,
        workflowRunId: scan.workflowRunId ?? fresh.result.workflowRunId,
        workflowRunUrl: scan.workflowRunUrl ?? fresh.result.workflowRunUrl,
        findings: findingsSummary ?? fresh.result.findings,
        stateVersion,
        reconciledFromScanAt: durableNow(),
        childScanStage: scan.stage,
      },
      transitions: sm.cloneTransitions(),
      updatedAt: durableNow(),
    };

    await saveA2ATask(updated);
    const auditId = `audit_${taskId}_${stateVersion}_${Date.now()}`;
    await appendAuditEvent({
      id: auditId,
      taskId,
      scanId,
      previousState: previousStatus,
      newState: updated.status,
      reason: "child_scan_ready",
      actor,
      correlation: {
        taskId,
        scanId,
        workflowRunId: scan.workflowRunId,
        dispatchAttempt: dispatchMeta.dispatchAttempt,
        stateVersion,
      },
      at: durableNow(),
    });

    logMarketplaceTelemetry("a2a_parent_reconciled_from_scan", {
      taskId,
      scanId,
      previousStatus,
      newStatus: updated.status,
      actor,
    });

    return {
      taskId,
      scanId,
      advanced: true,
      alreadyAdvanced: false,
      previousStatus,
      newStatus: updated.status,
      reason: "child_ready_advanced_parent",
      task: updated,
    };
  }

  if (FAILED_CHILD_STAGES.has(scan.stage)) {
    if (A2A_TERMINAL_STATUSES.includes(fresh.status)) {
      return {
        taskId,
        scanId,
        advanced: false,
        alreadyAdvanced: true,
        previousStatus,
        newStatus: fresh.status,
        reason: "parent_already_terminal",
        task: fresh,
      };
    }

    const sm = new A2ATaskStateMachine(fresh.transitions);
    const failureDetail = (scan.failureMessage || scan.failureCode || "deep scan failed")
      .toString()
      .slice(0, 500);
    sm.emit("analysis_failed", "repository_analyzer", `reconcile: child ${scan.id} ${scan.stage}`);
    const stateVersion = nextStateVersion(fresh);
    const updated: A2ATaskRecord = {
      ...fresh,
      status: "analysis_failed",
      error: failureDetail,
      result: {
        ...fresh.result,
        deepScanJobId: scan.id,
        queueJobId: scan.id,
        dispatchState:
          scan.stage === "FAILED_RETRYABLE" ? "FAILED_RETRYABLE" : "FAILED_TERMINAL",
        dispatchAttempt: dispatchMeta.dispatchAttempt,
        workflowRunId: scan.workflowRunId ?? fresh.result.workflowRunId,
        stateVersion,
        reconciledFromScanAt: durableNow(),
        childScanStage: scan.stage,
        recoverable: scan.stage === "FAILED_RETRYABLE",
      },
      transitions: sm.cloneTransitions(),
      updatedAt: durableNow(),
    };
    await saveA2ATask(updated);
    await appendAuditEvent({
      id: `audit_${taskId}_${stateVersion}_${Date.now()}`,
      taskId,
      scanId,
      previousState: previousStatus,
      newState: "analysis_failed",
      reason: "child_scan_failed",
      actor,
      correlation: {
        taskId,
        scanId,
        workflowRunId: scan.workflowRunId,
        dispatchAttempt: dispatchMeta.dispatchAttempt,
        stateVersion,
      },
      at: durableNow(),
    });

    return {
      taskId,
      scanId,
      advanced: true,
      alreadyAdvanced: false,
      previousStatus,
      newStatus: "analysis_failed",
      reason: "child_failed_advanced_parent",
      task: updated,
    };
  }

  // Non-terminal child — refresh dispatch metadata only.
  const patched = await updateA2ATask(taskId, {
    result: {
      ...fresh.result,
      deepScanJobId: scan.id,
      queueJobId: scan.id,
      dispatchState: dispatchMeta.dispatchState,
      dispatchAttempt: dispatchMeta.dispatchAttempt,
      workflowRunId: scan.workflowRunId ?? fresh.result.workflowRunId,
      workflowRunUrl: scan.workflowRunUrl ?? fresh.result.workflowRunUrl,
      childScanStage: scan.stage,
    },
  });

  return {
    taskId,
    scanId,
    advanced: false,
    alreadyAdvanced: false,
    previousStatus,
    newStatus: patched?.status ?? fresh.status,
    reason: "child_still_running",
    task: patched ?? fresh,
  };
}

/** Repair path for status polls: reconcile if parent has a linked deep scan. */
export async function reconcileParentTaskIfNeeded(
  task: A2ATaskRecord,
  actor: TaskAuditEvent["actor"] = "status_poll"
): Promise<A2ATaskRecord> {
  const scanId =
    (typeof task.result.deepScanJobId === "string" && task.result.deepScanJobId) ||
    (typeof task.result.queueJobId === "string" && task.result.queueJobId) ||
    undefined;
  if (!scanId) return task;
  if (A2A_TERMINAL_STATUSES.includes(task.status) && task.result.findings) return task;
  const result = await reconcileParentTaskFromScan(task.id, scanId, { actor });
  return result?.task ?? task;
}

/**
 * Recovery job: find dispatched parents whose scans are terminal and repair them.
 */
export async function recoverStrandedA2AParentTasks(options?: {
  taskIds?: string[];
  limit?: number;
}): Promise<{
  inspected: number;
  advanced: number;
  results: ParentScanReconcileResult[];
}> {
  const results: ParentScanReconcileResult[] = [];
  let advanced = 0;
  const taskIds = options?.taskIds ?? [];
  for (const taskId of taskIds.slice(0, options?.limit ?? 50)) {
    const task = await getA2ATask(taskId);
    if (!task) continue;
    const scanId =
      (typeof task.result.deepScanJobId === "string" && task.result.deepScanJobId) ||
      undefined;
    if (!scanId) continue;
    const result = await reconcileParentTaskFromScan(taskId, scanId, {
      actor: "scheduled_job",
    });
    if (result) {
      results.push(result);
      if (result.advanced) advanced += 1;
    }
  }
  return { inspected: results.length, advanced, results };
}
