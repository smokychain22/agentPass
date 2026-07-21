/**
 * Public DTO serializers — allowlist only. Never spread full internal records.
 */

import type { DeepScanJob } from "@/lib/deep-scan/types";
import { readDispatchMeta } from "@/lib/deep-scan/dispatch-queued-job";

const SECRET_KEY_PATTERN =
  /(token|secret|authorization|privateKey|apiKey|dispatchToken|callbackToken|leaseToken|claimToken|password|seed|mnemonic)/i;

export function looksLikeSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

/** Public dispatch progress — no raw tokens. */
export function toPublicDispatchDto(job: DeepScanJob) {
  const meta = readDispatchMeta(job);
  return {
    dispatchState: meta.dispatchState,
    dispatchAttempt: meta.dispatchAttempt,
    dispatchRequestedAt: meta.dispatchRequestedAt ?? null,
    lastDispatchError: meta.lastDispatchError
      ? String(meta.lastDispatchError).replace(
          /gh[pousr]_[A-Za-z0-9_]{20,}|[A-Za-z0-9_-]{32,}/g,
          "[redacted]"
        )
      : null,
    lastDispatchErrorCode: meta.lastDispatchErrorCode ?? null,
    nextRetryAt: meta.nextRetryAt ?? null,
    workflowRunId: meta.workflowRunId ?? null,
    workflowRunUrl: meta.workflowRunUrl ?? null,
    lastWorkflowCheckAt: meta.lastWorkflowCheckAt ?? null,
    // Explicitly omit: dispatchToken, dispatchTokenDigest, claim tokens, leases
  };
}

export function toPublicDeepScanDto(job: DeepScanJob) {
  const dispatch = toPublicDispatchDto(job);
  const terminal =
    job.status === "complete" ||
    job.status === "failed" ||
    ["READY", "COMPLETED", "CANCELLED", "FAILED_TERMINAL", "FAILED", "WORKER_STALLED"].includes(
      job.stage
    );

  return {
    ok: true as const,
    terminal,
    deepScanId: job.id,
    taskId: job.request.a2aTaskId ?? job.id,
    queueJobId: job.id,
    status: job.status,
    stage: job.stage,
    dispatchState: dispatch.dispatchState,
    dispatchAttempt: dispatch.dispatchAttempt,
    workflowRunId: job.workflowRunId ?? null,
    workflowRunUrl: job.workflowRunUrl ?? null,
    workerId: job.claimedBy ?? job.workerIdentity ?? null,
    // leaseExpiresAt intentionally omitted from public responses
    progress: (job.statusHistory ?? []).map((entry) => ({
      stage: entry.stage,
      at: entry.at,
      detail: entry.detail,
    })),
    progressDetail: job.progress,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    job: {
      id: job.id,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      tenantId: job.tenantId ?? job.request.tenantId,
      a2aTaskId: job.request.a2aTaskId,
      repositoryOwner: job.repositoryOwner,
      repositoryName: job.repositoryName,
      repositoryFullName: job.repositoryFullName,
      branch: job.branch,
      sourceCommit: job.sourceCommit,
      projectRoot: job.projectRoot,
      scanId: job.scanId,
      findingsId: job.findingsId,
      graphId: job.graphId,
      coverage: job.coverage,
      baseline: job.baseline,
      resultSummary: sanitizeResultSummary(job.resultSummary),
      failureCode: job.failureCode,
      failureMessage: job.failureMessage,
      claimedBy: job.claimedBy,
      workerIdentity: job.workerIdentity,
      workerHost: job.workerHost,
      workerMode: job.workerMode,
      claimedAt: job.claimedAt,
      heartbeatAt: job.heartbeatAt,
      stageStartedAt: job.stageStartedAt,
      lastActivityAt: job.lastActivityAt,
      progressMessage: job.progressMessage,
      completedUnits: job.completedUnits,
      totalUnits: job.totalUnits,
      timingBreakdown: job.timingBreakdown,
      workflowRunId: job.workflowRunId,
      workflowRunUrl: job.workflowRunUrl,
      workflowRunAttempt: job.workflowRunAttempt,
      attemptCount: job.attemptCount,
      statusHistory: job.statusHistory,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt,
      dispatch,
    },
  };
}

function sanitizeResultSummary(
  summary: DeepScanJob["resultSummary"]
): Record<string, unknown> | undefined {
  if (!summary || typeof summary !== "object") return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(summary)) {
    if (looksLikeSecretKey(key)) continue;
    if (key === "dispatch" && value && typeof value === "object") {
      const d = value as Record<string, unknown>;
      out.dispatch = {
        dispatchState: d.dispatchState,
        dispatchAttempt: d.dispatchAttempt,
        dispatchRequestedAt: d.dispatchRequestedAt,
        lastDispatchError: d.lastDispatchError,
        lastDispatchErrorCode: d.lastDispatchErrorCode,
        nextRetryAt: d.nextRetryAt,
        workflowRunId: d.workflowRunId,
        workflowRunUrl: d.workflowRunUrl,
      };
      continue;
    }
    out[key] = value;
  }
  return out;
}

/** Recursively assert no secret-like keys exist in a public payload (for tests). */
export function assertNoSecretKeys(value: unknown, path = "$"): string[] {
  const hits: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, i) => hits.push(...assertNoSecretKeys(item, `${path}[${i}]`)));
    return hits;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (looksLikeSecretKey(key)) hits.push(`${path}.${key}`);
      hits.push(...assertNoSecretKeys(child, `${path}.${key}`));
    }
  }
  return hits;
}
