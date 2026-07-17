import { NextResponse } from "next/server";
import {
  assertWorkerAuthorized,
  WorkerAuthError,
} from "@/lib/worker/worker-auth";
import { consumeDispatchNonce } from "@/lib/github-actions/dispatch-nonce-store";
import { ACTIONS_WORKER_ID } from "@/lib/github-actions/dispatch-analysis";
import { claimDeepScanJobById, getDeepScanJob, updateDeepScanStage } from "@/lib/deep-scan/job-store";
import { ACTIONS_ANALYSIS_LIMITS } from "@/lib/github-actions/limits";
import { buildArchiveDescriptor } from "@/lib/github-actions/archive-descriptor";
import { touchMarketplaceHealth } from "@/lib/okx/marketplace-telemetry";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Trusted Actions claim job exchanges dispatchNonce for claimToken + public archive URL.
 * Never logs secrets or private installation tokens.
 */
export async function POST(request: Request) {
  try {
    assertWorkerAuthorized(request);
  } catch (err) {
    if (err instanceof WorkerAuthError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message },
        { status: 401 }
      );
    }
    throw err;
  }

  let body: {
    jobId?: string;
    dispatchNonce?: string;
    workerId?: string;
    workflowRunId?: string;
    workflowRunUrl?: string;
    workflowRunAttempt?: string;
    workflowName?: string;
    workflowRepository?: string;
    workflowServerUrl?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, code: "INVALID_INPUT", error: "JSON body required." },
      { status: 400 }
    );
  }

  const jobId = body.jobId?.trim();
  const dispatchNonce = body.dispatchNonce?.trim();
  const workerId = body.workerId?.trim() || ACTIONS_WORKER_ID;
  if (!jobId || !dispatchNonce) {
    return NextResponse.json(
      { ok: false, code: "INVALID_INPUT", error: "jobId and dispatchNonce are required." },
      { status: 422 }
    );
  }

  const nonce = await consumeDispatchNonce(dispatchNonce, jobId);
  if (!nonce) {
    // Idempotent: if this workflow already claimed, allow re-read with worker auth + job ownership check below.
    const existing = await getDeepScanJob(jobId);
    if (
      existing?.claimedBy === workerId &&
      existing.claimToken &&
      existing.leaseExpiresAt &&
      Date.parse(existing.leaseExpiresAt) > Date.now()
    ) {
      return NextResponse.json({
        ok: true,
        alreadyClaimed: true,
        code: "ALREADY_CLAIMED",
        claimToken: existing.claimToken,
        workerId,
        job: sanitizeJob(existing),
        archive: buildArchiveDescriptor(existing),
        limits: ACTIONS_ANALYSIS_LIMITS,
      });
    }
    return NextResponse.json(
      {
        ok: false,
        code: "NONCE_INVALID",
        error: "Dispatch nonce missing, expired, or already used.",
      },
      { status: 409 }
    );
  }

  const claim = await claimDeepScanJobById(jobId, workerId);
  if (!claim.ok) {
    if (claim.code === "CLAIMED_BY_OTHER") {
      return NextResponse.json(
        { ok: true, alreadyClaimed: true, code: "ALREADY_CLAIMED", message: claim.message },
        { status: 200 }
      );
    }
    return NextResponse.json(
      { ok: false, code: claim.code, error: claim.message },
      { status: claim.code === "NOT_FOUND" ? 404 : 409 }
    );
  }

  const patch: Record<string, unknown> = {
    workflowRunId: body.workflowRunId?.trim() || claim.job.workflowRunId,
    workflowRunUrl: body.workflowRunUrl?.trim() || claim.job.workflowRunUrl,
    workerMode: "github_actions_on_demand",
    workerHost: "github-actions/ubuntu-latest",
    resultSummary: {
      ...(claim.job.resultSummary ?? {}),
      github: {
        runId: body.workflowRunId?.trim(),
        runAttempt: body.workflowRunAttempt?.trim(),
        workflow: body.workflowName?.trim(),
        repository: body.workflowRepository?.trim(),
        serverUrl: body.workflowServerUrl?.trim(),
        runUrl: body.workflowRunUrl?.trim(),
      },
    },
  };
  const updated =
    (await updateDeepScanStage(
      jobId,
      "CLAIMED",
      `GitHub Actions runner claimed (${workerId}) run=${body.workflowRunId ?? "unknown"}`,
      patch
    )) ?? claim.job;

  await touchMarketplaceHealth({
    activeWorkers: 1,
    activeWorkflowRuns: 1,
    workerReady: true,
    workerReadySource: "github_actions_dispatcher",
    workerVersion: "github-actions-on-demand",
    workerMode: "github_actions_on_demand",
  });

  return NextResponse.json({
    ok: true,
    alreadyClaimed: claim.alreadyClaimed,
    claimToken: updated.claimToken,
    workerId,
    job: sanitizeJob(updated),
    archive: buildArchiveDescriptor(updated),
    limits: ACTIONS_ANALYSIS_LIMITS,
  });
}

function sanitizeJob(job: Awaited<ReturnType<typeof getDeepScanJob>>) {
  if (!job) return null;
  return {
    id: job.id,
    stage: job.stage,
    status: job.status,
    repositoryOwner: job.repositoryOwner,
    repositoryName: job.repositoryName,
    branch: job.branch,
    sourceCommit: job.sourceCommit,
    projectRoot: job.projectRoot,
    structureScanId: job.request.structureScanId,
    repoUrl: job.request.repoUrl,
    readOnly: job.request.readOnly !== false,
    workflowRunId: job.workflowRunId,
    workflowRunUrl: job.workflowRunUrl,
    analysisConfigDigest: job.analysisConfigDigest,
  };
}
