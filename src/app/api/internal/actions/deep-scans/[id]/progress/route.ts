import { NextResponse } from "next/server";
import {
  assertWorkerCallbackAuthorized,
  WorkerAuthError,
} from "@/lib/worker/worker-auth";
import {
  getDeepScanJob,
  recordDeepScanProgress,
} from "@/lib/deep-scan/job-store";
import type { DeepScanStage } from "@/lib/deep-scan/types";
import {
  ActionsCallbackAuthError,
  assertCallbackTimestampFresh,
  type ActionsCallbackPayload,
  verifyActionsCallbackSignature,
  verifyProgressToken,
} from "@/lib/github-actions/callback-auth";
import { ACTIONS_WORKER_ID } from "@/lib/github-actions/dispatch-analysis";
import type { TimingBreakdown } from "@/lib/deep-scan/timing-breakdown";

export const runtime = "nodejs";
export const maxDuration = 30;

const EXPECTED_WORKFLOW = "RepoDiet analysis worker";
const EXPECTED_REPOSITORY = "smokychain22/agentPass";

/**
 * Authenticated intermediate progress for GitHub Actions workers.
 *
 * Auth modes:
 * 1. Trusted claim/complete: WORKER_CALLBACK_SECRET + HMAC signature
 * 2. Secretless analyze: progressToken (scoped) + claimHandle — never Worker API key / callback secret
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: jobId } = await context.params;
  let body: {
    workerId?: string;
    claimHandle?: string;
    progressToken?: string;
    claimToken?: string;
    workflowRunId?: string;
    workflowRunAttempt?: string | number;
    workflowName?: string;
    repository?: string;
    completionNonce?: string;
    timestamp?: string;
    stage?: DeepScanStage;
    detail?: string;
    progressMessage?: string;
    completedUnits?: number;
    totalUnits?: number;
    heartbeatOnly?: boolean;
    timingPatch?: TimingBreakdown;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, code: "INVALID_INPUT", error: "JSON body required." },
      { status: 400 }
    );
  }

  if (body.claimToken) {
    return NextResponse.json(
      {
        ok: false,
        code: "CLAIM_TOKEN_NOT_ACCEPTED",
        error: "claimToken must not be sent by Actions workers.",
      },
      { status: 422 }
    );
  }

  const job = await getDeepScanJob(jobId);
  if (!job) {
    return NextResponse.json(
      { ok: false, code: "JOB_NOT_FOUND", error: "Deep-scan job not found." },
      { status: 404 }
    );
  }

  const workerId = body.workerId?.trim() || ACTIONS_WORKER_ID;
  const workflowRunId = body.workflowRunId?.trim() || job.workflowRunId || "";
  const workflowRunAttempt = String(body.workflowRunAttempt ?? job.workflowRunAttempt ?? "1");
  const workflowName = body.workflowName?.trim() || job.workflowName || EXPECTED_WORKFLOW;
  const repository = body.repository?.trim() || job.workflowRepository || EXPECTED_REPOSITORY;
  const timestamp = body.timestamp?.trim() || new Date().toISOString();
  const completionNonce = body.completionNonce?.trim() || `cn_progress_${Date.now()}`;

  let authMode: "signed_callback" | "progress_token" | null = null;

  // Mode 1: signed callback (trusted claim/complete jobs).
  try {
    assertWorkerCallbackAuthorized(request);
    const signature =
      request.headers.get("x-worker-callback-signature") ||
      request.headers.get("x-repodiet-callback-signature");
    const callbackPayload: ActionsCallbackPayload = {
      jobId,
      workflowRunId,
      workflowRunAttempt,
      workflowName,
      repository,
      completionNonce,
      timestamp,
      stage: body.stage,
    };
    if (!signature || !verifyActionsCallbackSignature(callbackPayload, signature)) {
      return NextResponse.json(
        { ok: false, code: "CALLBACK_SIGNATURE_INVALID", error: "Callback signature validation failed." },
        { status: 401 }
      );
    }
    if (!assertCallbackTimestampFresh(timestamp)) {
      return NextResponse.json(
        { ok: false, code: "CALLBACK_TIMESTAMP_STALE", error: "Callback timestamp outside replay window." },
        { status: 401 }
      );
    }
    authMode = "signed_callback";
  } catch (err) {
    if (!(err instanceof WorkerAuthError)) throw err;
    // Mode 2: progress token from secretless analyze.
    const progressToken = body.progressToken?.trim();
    const claimHandle = body.claimHandle?.trim();
    if (!progressToken || !claimHandle) {
      return NextResponse.json(
        {
          ok: false,
          code: "PROGRESS_AUTH_REQUIRED",
          error: "Signed callback or progressToken+claimHandle required.",
        },
        { status: 401 }
      );
    }
    if (job.claimHandle && claimHandle !== job.claimHandle) {
      return NextResponse.json(
        { ok: false, code: "WORKFLOW_IDENTITY_MISMATCH", error: "claimHandle mismatch." },
        { status: 409 }
      );
    }
    if (!verifyProgressToken(progressToken, job.progressTokenHash)) {
      return NextResponse.json(
        { ok: false, code: "PROGRESS_TOKEN_INVALID", error: "Invalid progress token." },
        { status: 401 }
      );
    }
    authMode = "progress_token";
  }

  if (
    job.stage === "READY" ||
    job.stage === "COMPLETED" ||
    job.stage === "CANCELLED" ||
    job.stage === "FAILED_TERMINAL"
  ) {
    return NextResponse.json({
      ok: true,
      idempotent: true,
      stage: job.stage,
      jobId,
      authMode,
    });
  }

  try {
    const updated = await recordDeepScanProgress(jobId, {
      stage: body.stage,
      detail: body.detail,
      progressMessage: body.progressMessage ?? body.detail,
      completedUnits: body.completedUnits,
      totalUnits: body.totalUnits,
      workerIdentity: workerId,
      workflowRunId: workflowRunId || undefined,
      workflowRunAttempt,
      timingPatch: body.timingPatch,
      heartbeatOnly: body.heartbeatOnly === true && !body.stage,
    });
    return NextResponse.json({
      ok: true,
      stage: updated?.stage,
      jobId,
      authMode,
      lastActivityAt: updated?.lastActivityAt,
      stageStartedAt: updated?.stageStartedAt,
    });
  } catch (err) {
    if (err instanceof ActionsCallbackAuthError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message },
        { status: 409 }
      );
    }
    throw err;
  }
}
