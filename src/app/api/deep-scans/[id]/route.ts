import { NextResponse } from "next/server";
import { getDeepScanJob } from "@/lib/deep-scan/job-store";
import { readDispatchMeta } from "@/lib/deep-scan/dispatch-queued-job";
import {
  denyUnlessTenantOwns,
  resolveTenantIdentity,
  tenantDenialResponse,
} from "@/lib/tenant/request-auth";

export const runtime = "nodejs";
export const maxDuration = 20;

/**
 * Progress for a deep-scan job.
 * A2A acknowledgements advertise `/api/deep-scans/{id}` to anonymous customers —
 * when the job is bound to an a2aTaskId, that opaque id is the access grant
 * (same as knowing the task status URL). Tenant mismatch still 404s otherwise.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const job = await getDeepScanJob(id);
  if (!job) {
    return NextResponse.json(
      { ok: false, error: "Deep scan job not found.", code: "TASK_NOT_FOUND" },
      { status: 404 }
    );
  }

  const identity = resolveTenantIdentity(request);
  const a2aBound = Boolean(job.request.a2aTaskId);
  const resourceTenant = job.tenantId ?? job.request.tenantId;
  const allowA2aProgress =
    a2aBound &&
    (identity.source === "anonymous" ||
      identity.tenantId === "anonymous_public_readonly" ||
      (typeof resourceTenant === "string" && resourceTenant.startsWith("a2a:")));

  if (!allowA2aProgress) {
    const denial = denyUnlessTenantOwns({
      resourceTenantId: resourceTenant,
      requestTenantId: identity.tenantId,
    });
    if (denial) {
      const response = tenantDenialResponse(denial, 404);
      return NextResponse.json(response.body, { status: response.status });
    }
  }

  const dispatch = readDispatchMeta(job);
  const terminal =
    job.status === "complete" ||
    job.status === "failed" ||
    ["READY", "COMPLETED", "CANCELLED", "FAILED_TERMINAL", "FAILED", "WORKER_STALLED"].includes(
      job.stage
    );

  return NextResponse.json({
    ok: true,
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
    leaseExpiresAt: job.leaseExpiresAt ?? null,
    progress: job.statusHistory ?? [],
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
      resultSummary: job.resultSummary,
      failureCode: job.failureCode,
      failureMessage: job.failureMessage,
      claimedBy: job.claimedBy,
      workerIdentity: job.workerIdentity,
      workerHost: job.workerHost,
      workerMode: job.workerMode,
      claimedAt: job.claimedAt,
      heartbeatAt: job.heartbeatAt,
      leaseExpiresAt: job.leaseExpiresAt,
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
  });
}
