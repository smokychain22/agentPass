import { NextResponse } from "next/server";
import {
  assertWorkerCallbackAuthorized,
  WorkerAuthError,
} from "@/lib/worker/worker-auth";
import {
  assertDeepScanClaim,
  DeepScanClaimError,
  failDeepScanJob,
  getDeepScanJob,
  heartbeatDeepScanJob,
  updateDeepScanStage,
} from "@/lib/deep-scan/job-store";
import { storeFindings } from "@/lib/findings/findings-store";
import { saveRepositoryGraph } from "@/lib/repository-graph/graph-store";
import type { FindingsPayload } from "@/lib/findings/types";
import type { DeepScanStage } from "@/lib/deep-scan/types";
import { touchMarketplaceHealth } from "@/lib/okx/marketplace-telemetry";
import { createHash } from "node:crypto";
import {
  ActionsCallbackAuthError,
  assertCallbackTimestampFresh,
  consumeCompletionNonce,
  type ActionsCallbackPayload,
  verifyActionsCallbackSignature,
} from "@/lib/github-actions/callback-auth";
import { ACTIONS_WORKER_ID } from "@/lib/github-actions/dispatch-analysis";

export const runtime = "nodejs";
export const maxDuration = 60;

const EXPECTED_WORKFLOW = "RepoDiet analysis worker";
const EXPECTED_REPOSITORY = "smokychain22/agentPass";

/**
 * Trusted Actions complete callback.
 * Auth: WORKER_CALLBACK_SECRET + HMAC signature over workflow identity.
 * claimToken is resolved server-side from the durable job — never accepted from the client.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertWorkerCallbackAuthorized(request);
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
    workerId?: string;
    /** Ignored if present — never trusted from the wire. */
    claimToken?: string;
    claimHandle?: string;
    workflowRunId?: string;
    workflowRunAttempt?: string | number;
    workflowName?: string;
    repository?: string;
    completionNonce?: string;
    timestamp?: string;
    stage?: DeepScanStage;
    detail?: string;
    heartbeatOnly?: boolean;
    failureCode?: string;
    failureMessage?: string;
    terminal?: boolean;
    resultDigest?: string;
    sourceCommit?: string;
    findings?: FindingsPayload;
    graph?: {
      id: string;
      repository: string;
      branch: string;
      sourceCommit: string;
      projectRoot?: string;
      [key: string]: unknown;
    };
    coverage?: Record<string, unknown>;
    baseline?: Record<string, unknown>;
    resultSummary?: Record<string, unknown>;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, code: "INVALID_INPUT", error: "JSON body required." },
      { status: 400 }
    );
  }

  // Reject any attempt to supply a claim token from the runner.
  if (body.claimToken) {
    return NextResponse.json(
      {
        ok: false,
        code: "CLAIM_TOKEN_NOT_ACCEPTED",
        error: "claimToken must not be sent by Actions workers; it is server-side only.",
      },
      { status: 422 }
    );
  }

  const workerId = body.workerId?.trim() || ACTIONS_WORKER_ID;
  const workflowRunId = body.workflowRunId?.trim();
  const workflowRunAttempt = String(body.workflowRunAttempt ?? "").trim();
  const workflowName = body.workflowName?.trim() || EXPECTED_WORKFLOW;
  const repository = body.repository?.trim() || EXPECTED_REPOSITORY;
  const completionNonce = body.completionNonce?.trim();
  const timestamp = body.timestamp?.trim();

  if (!workflowRunId || !workflowRunAttempt || !completionNonce || !timestamp) {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_INPUT",
        error: "workflowRunId, workflowRunAttempt, completionNonce, and timestamp are required.",
      },
      { status: 422 }
    );
  }

  const callbackPayload: ActionsCallbackPayload = {
    jobId,
    workflowRunId,
    workflowRunAttempt,
    workflowName,
    repository,
    completionNonce,
    timestamp,
    resultDigest: body.resultDigest,
    stage: body.stage,
    code: body.failureCode,
  };

  const signature =
    request.headers.get("x-worker-callback-signature") ||
    request.headers.get("x-repodiet-callback-signature");

  if (!verifyActionsCallbackSignature(callbackPayload, signature)) {
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

  const nonceOk = await consumeCompletionNonce(completionNonce, jobId);
  if (!nonceOk) {
    // Idempotent READY: if already READY with matching run, succeed.
    const existing = await getDeepScanJob(jobId);
    if (
      existing &&
      (existing.stage === "READY" || existing.stage === "COMPLETED") &&
      existing.workflowRunId === workflowRunId
    ) {
      return NextResponse.json({
        ok: true,
        idempotent: true,
        stage: existing.stage,
        jobId,
        findingsId: existing.findingsId,
      });
    }
    return NextResponse.json(
      { ok: false, code: "COMPLETION_NONCE_REPLAY", error: "Completion nonce already used." },
      { status: 409 }
    );
  }

  const job = await getDeepScanJob(jobId);
  if (!job) {
    return NextResponse.json(
      { ok: false, code: "JOB_NOT_FOUND", error: "Deep-scan job not found." },
      { status: 404 }
    );
  }

  try {
    assertWorkflowIdentity(job, {
      workflowRunId,
      workflowRunAttempt,
      workflowName,
      repository,
      claimHandle: body.claimHandle?.trim(),
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

  // Resolve claim token server-side only.
  const claimToken = job.claimToken;
  if (!claimToken) {
    return NextResponse.json(
      {
        ok: false,
        code: "CLAIM_LEASE_INVALID",
        error: "No server-side claim token for this job.",
      },
      { status: 409 }
    );
  }

  try {
    assertDeepScanClaim(job, workerId, claimToken);
  } catch (err) {
    if (err instanceof DeepScanClaimError) {
      // Late result after lease expiry — still accept READY if workflow identity matched
      // and stage is still CLAIMED/analyzing; otherwise structured failure.
      if (
        err.code === "LEASE_EXPIRED" &&
        body.stage === "READY" &&
        job.workflowRunId === workflowRunId
      ) {
        // Continue — explicit late-result acceptance for matched workflow.
      } else {
        return NextResponse.json(
          { ok: false, code: err.code, error: err.message },
          { status: 409 }
        );
      }
    } else {
      throw err;
    }
  }

  if (body.heartbeatOnly) {
    const hb = await heartbeatDeepScanJob(jobId, workerId, body.detail, claimToken);
    return NextResponse.json({ ok: true, heartbeat: true, stage: hb?.stage, jobId });
  }

  if (
    body.failureCode ||
    body.stage === "FAILED" ||
    body.stage === "FAILED_TERMINAL" ||
    body.stage === "FAILED_RETRYABLE"
  ) {
    const failed = await failDeepScanJob(
      jobId,
      body.failureCode || "ACTIONS_ANALYZER_FAILED",
      body.failureMessage || body.detail || "GitHub Actions analysis failed.",
      { terminal: body.terminal !== false && body.stage !== "FAILED_RETRYABLE" }
    );
    return NextResponse.json({ ok: true, failed: true, stage: failed?.stage, jobId });
  }

  if (body.stage && body.stage !== "READY" && body.stage !== "COMPLETED") {
    const updated = await updateDeepScanStage(jobId, body.stage, body.detail);
    await heartbeatDeepScanJob(jobId, workerId, body.detail, claimToken);
    return NextResponse.json({ ok: true, stage: updated?.stage, jobId });
  }

  if (!body.findings) {
    return NextResponse.json(
      { ok: false, code: "INVALID_INPUT", error: "findings payload required for READY ingest." },
      { status: 422 }
    );
  }

  const expectedCommit = job.sourceCommit || job.request.sourceCommit;
  if (body.sourceCommit && expectedCommit && body.sourceCommit !== expectedCommit) {
    return NextResponse.json(
      {
        ok: false,
        code: "SOURCE_COMMIT_MISMATCH",
        error: "Result source commit does not match the durable job pin.",
      },
      { status: 409 }
    );
  }

  const digest = createHash("sha256")
    .update(JSON.stringify({ scanId: body.findings.scanId, summary: body.findings.summary }))
    .digest("hex");
  if (body.resultDigest && body.resultDigest !== digest) {
    return NextResponse.json(
      { ok: false, code: "RESULT_DIGEST_MISMATCH", error: "Result digest validation failed." },
      { status: 409 }
    );
  }

  // Idempotent: already READY with same findings.
  if (job.stage === "READY" && job.findingsId === body.findings.scanId) {
    return NextResponse.json({
      ok: true,
      idempotent: true,
      ready: true,
      jobId,
      stage: job.stage,
      findingsId: job.findingsId,
      resultDigest: digest,
    });
  }

  await storeFindings(body.findings);
  if (body.graph?.id) {
    try {
      await saveRepositoryGraph(body.graph as never);
    } catch {
      // Graph persistence is best-effort; findings remain authoritative for READY.
    }
  }

  const timingBreakdown =
    (body.resultSummary?.timingBreakdown as Record<string, number> | undefined) ??
    job.timingBreakdown;

  const ready = await updateDeepScanStage(jobId, "READY", "GitHub Actions analysis complete", {
    findingsId: body.findings.scanId,
    graphId: body.graph?.id || job.graphId,
    coverage: body.coverage,
    baseline: body.baseline ?? {
      status: "NOT_RUN",
      verification: "SANDBOX_REQUIRED",
      reason: "READ_ONLY_FINDINGS",
    },
    lastCompletionNonce: completionNonce,
    // Invalidate claim token after successful complete.
    claimToken: undefined,
    progressTokenHash: undefined,
    leaseExpiresAt: undefined,
    // Invalidate any previously exposed dispatch nonce/token.
    dispatchNonce: undefined,
    dispatchNonceUsedAt: new Date().toISOString(),
    timingBreakdown,
    resultSummary: scrubDispatchSecretsFromSummary(
      body.resultSummary ?? {
        findings: body.findings.summary,
        workerMode: "github_actions_on_demand",
        resultDigest: digest,
        timingBreakdown,
      },
      job.resultSummary
    ),
  });

  await touchMarketplaceHealth({
    activeWorkers: 0,
    activeWorkflowRuns: 0,
    lastSuccessfulWorkerRun: new Date().toISOString(),
  });

  // Primary completion path: advance parent A2A task from child READY.
  if (job.request.a2aTaskId) {
    try {
      const { reconcileParentTaskFromScan } = await import(
        "@/lib/a2a/reconcile-parent-from-scan"
      );
      await reconcileParentTaskFromScan(job.request.a2aTaskId, jobId, {
        actor: "ingest_callback",
      });
    } catch (err) {
      console.error("[deep-scan-ingest] parent reconcile failed", jobId, err);
    }
  }

  return NextResponse.json({
    ok: true,
    ready: true,
    jobId,
    stage: ready?.stage,
    findingsId: body.findings.scanId,
    graphId: body.graph?.id,
    resultDigest: digest,
  });
}

function scrubDispatchSecretsFromSummary(
  incoming: Record<string, unknown>,
  previous?: Record<string, unknown>
): Record<string, unknown> {
  const prevDispatch = (previous?.dispatch ?? {}) as Record<string, unknown>;
  const nextDispatch = (incoming.dispatch ?? prevDispatch) as Record<string, unknown>;
  const { dispatchToken: _t, dispatchNonce: _n, ...safeDispatch } = {
    ...nextDispatch,
    dispatchToken: undefined,
    dispatchNonce: undefined,
  };
  return {
    ...incoming,
    dispatch: {
      ...safeDispatch,
      dispatchToken: undefined,
      dispatchNonce: undefined,
      tokenInvalidatedAt: new Date().toISOString(),
    },
  };
}

function assertWorkflowIdentity(
  job: NonNullable<Awaited<ReturnType<typeof getDeepScanJob>>>,
  input: {
    workflowRunId: string;
    workflowRunAttempt: string;
    workflowName: string;
    repository: string;
    claimHandle?: string;
  }
): void {
  if (job.workflowRunId && job.workflowRunId !== input.workflowRunId) {
    throw new ActionsCallbackAuthError(
      "WORKFLOW_IDENTITY_MISMATCH",
      "workflowRunId does not match the claimed job."
    );
  }
  if (job.workflowRunAttempt && job.workflowRunAttempt !== input.workflowRunAttempt) {
    throw new ActionsCallbackAuthError(
      "WORKFLOW_IDENTITY_MISMATCH",
      "workflowRunAttempt does not match the claimed job."
    );
  }
  if (job.workflowName && job.workflowName !== input.workflowName) {
    throw new ActionsCallbackAuthError(
      "WORKFLOW_IDENTITY_MISMATCH",
      "workflowName does not match the claimed job."
    );
  }
  if (job.workflowRepository && job.workflowRepository !== input.repository) {
    throw new ActionsCallbackAuthError(
      "WORKFLOW_IDENTITY_MISMATCH",
      "repository does not match the claimed job."
    );
  }
  if (input.repository !== EXPECTED_REPOSITORY) {
    throw new ActionsCallbackAuthError(
      "WORKFLOW_IDENTITY_MISMATCH",
      "Unexpected Actions repository for RepoDiet worker."
    );
  }
  if (input.claimHandle && job.claimHandle && input.claimHandle !== job.claimHandle) {
    throw new ActionsCallbackAuthError(
      "WORKFLOW_IDENTITY_MISMATCH",
      "claimHandle does not match the claimed job."
    );
  }
}
