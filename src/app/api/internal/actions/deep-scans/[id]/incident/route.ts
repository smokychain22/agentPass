import { NextResponse } from "next/server";
import {
  assertWorkerAuthorized,
  WorkerAuthError,
} from "@/lib/worker/worker-auth";
import {
  failDeepScanArchivePreparation,
  getDeepScanJob,
  updateDeepScanStage,
} from "@/lib/deep-scan/job-store";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Authenticated incident callback for pre-claim / claim-stage failures.
 * Does NOT require a claim token — Worker API key + optional callback secret only.
 * Used when claim itself fails so jobs never stay CLAIMED_STUCK / DISPATCHED forever.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
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

  const { id: jobId } = await context.params;
  let body: {
    code?: string;
    message?: string;
    terminal?: boolean;
    workflowRunId?: string;
    workflowRunUrl?: string;
    requestId?: string;
    stage?: "pre_claim" | "claim" | "archive" | "complete";
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, code: "INVALID_INPUT", error: "JSON body required." },
      { status: 400 }
    );
  }

  const job = await getDeepScanJob(jobId);
  if (!job) {
    return NextResponse.json(
      { ok: false, code: "JOB_NOT_FOUND", error: "Deep-scan job not found." },
      { status: 404 }
    );
  }

  if (job.stage === "READY" || job.stage === "COMPLETED") {
    return NextResponse.json(
      { ok: false, code: "ALREADY_COMPLETE", error: "Job already completed.", jobId, stage: job.stage },
      { status: 409 }
    );
  }

  if (job.stage === "FAILED_TERMINAL" || job.stage === "CANCELLED") {
    return NextResponse.json({
      ok: true,
      alreadyTerminal: true,
      jobId,
      stage: job.stage,
      failureCode: job.failureCode,
    });
  }

  const code = body.code?.trim() || "CLAIM_STAGE_FAILED";
  const message =
    body.message?.trim() || "Claim-stage failure reported by Actions worker.";
  const terminal =
    body.terminal === true ||
    code === "LEGACY_REPOSITORY_IDENTITY_MISSING" ||
    code === "REPOSITORY_IDENTITY_INCOMPLETE";

  // Prefer archive-prep helper so lease + claim token are always cleared.
  const updated = await failDeepScanArchivePreparation(jobId, code, message, {
    terminal,
    workflowRunId: body.workflowRunId?.trim(),
    workflowRunUrl: body.workflowRunUrl?.trim(),
    requestId: body.requestId?.trim(),
  });

  // Ensure status history notes the incident stage.
  if (updated && body.stage) {
    await updateDeepScanStage(jobId, updated.stage, `incident:${body.stage}`, {
      resultSummary: {
        ...(updated.resultSummary ?? {}),
        incident: {
          stage: body.stage,
          code,
          message,
          at: new Date().toISOString(),
        },
      },
    });
  }

  const finalJob = (await getDeepScanJob(jobId)) ?? updated;

  return NextResponse.json({
    ok: true,
    status: finalJob?.stage ?? (terminal ? "FAILED_TERMINAL" : "FAILED_RETRYABLE"),
    code,
    message,
    retryable: !terminal,
    jobId,
    workflowRunId: finalJob?.workflowRunId ?? body.workflowRunId,
    requestId: body.requestId,
    statusUrl: `/api/deep-scans/${jobId}`,
    requiredAction: terminal
      ? "Create a new smoke or findings job after repository identity is repaired."
      : "Retry after repository identity is repaired.",
  });
}
