import { NextResponse } from "next/server";
import {
  assertWorkerAuthorized,
  assertWorkerCallbackAuthorized,
  WorkerAuthError,
} from "@/lib/worker/worker-auth";
import {
  failDeepScanArchivePreparation,
  getDeepScanJob,
  updateDeepScanStage,
} from "@/lib/deep-scan/job-store";
import {
  assertCallbackTimestampFresh,
  consumeCompletionNonce,
  type ActionsCallbackPayload,
  verifyActionsCallbackSignature,
} from "@/lib/github-actions/callback-auth";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Authenticated incident callback for pre-claim / claim-stage failures.
 * Does NOT require a claim token.
 * Accepts either worker API key (claim job) or signed callback secret (complete job).
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  let authMode: "api_key" | "callback" = "api_key";
  try {
    if (
      request.headers.get("x-worker-callback-secret") ||
      request.headers.get("x-repodiet-callback-secret")
    ) {
      assertWorkerCallbackAuthorized(request);
      authMode = "callback";
    } else {
      assertWorkerAuthorized(request);
    }
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
    workflowRunAttempt?: string | number;
    workflowName?: string;
    repository?: string;
    requestId?: string;
    stage?: "pre_claim" | "claim" | "archive" | "complete";
    completionNonce?: string;
    timestamp?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, code: "INVALID_INPUT", error: "JSON body required." },
      { status: 400 }
    );
  }

  // When using callback auth with a signature, enforce HMAC + nonce.
  if (authMode === "callback" && body.completionNonce && body.timestamp && body.workflowRunId) {
    const payload: ActionsCallbackPayload = {
      jobId,
      workflowRunId: String(body.workflowRunId),
      workflowRunAttempt: String(body.workflowRunAttempt ?? "1"),
      workflowName: body.workflowName?.trim() || "RepoDiet analysis worker",
      repository: body.repository?.trim() || "smokychain22/agentPass",
      completionNonce: body.completionNonce.trim(),
      timestamp: body.timestamp.trim(),
      stage: body.stage,
      code: body.code,
    };
    const signature =
      request.headers.get("x-worker-callback-signature") ||
      request.headers.get("x-repodiet-callback-signature");
    if (!verifyActionsCallbackSignature(payload, signature)) {
      return NextResponse.json(
        { ok: false, code: "CALLBACK_SIGNATURE_INVALID", error: "Invalid callback signature." },
        { status: 401 }
      );
    }
    if (!assertCallbackTimestampFresh(payload.timestamp)) {
      return NextResponse.json(
        { ok: false, code: "CALLBACK_TIMESTAMP_STALE", error: "Stale callback timestamp." },
        { status: 401 }
      );
    }
    const nonceOk = await consumeCompletionNonce(payload.completionNonce, jobId);
    if (!nonceOk) {
      const existing = await getDeepScanJob(jobId);
      if (
        existing &&
        (existing.stage === "FAILED_RETRYABLE" ||
          existing.stage === "FAILED_TERMINAL" ||
          existing.stage === "CANCELLED")
      ) {
        return NextResponse.json({
          ok: true,
          alreadyTerminal: true,
          jobId,
          stage: existing.stage,
        });
      }
      return NextResponse.json(
        { ok: false, code: "COMPLETION_NONCE_REPLAY", error: "Completion nonce already used." },
        { status: 409 }
      );
    }
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

  const updated = await failDeepScanArchivePreparation(jobId, code, message, {
    terminal,
    workflowRunId: body.workflowRunId?.trim(),
    workflowRunUrl: body.workflowRunUrl?.trim(),
    requestId: body.requestId?.trim(),
  });

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
