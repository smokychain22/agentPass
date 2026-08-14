import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import {
  assertWorkerCallbackAuthorized,
  WorkerAuthError,
} from "@/lib/worker/worker-auth";
import {
  ActionsCallbackAuthError,
  assertCallbackTimestampFresh,
  consumeCompletionNonce,
  type ActionsCallbackPayload,
  verifyActionsCallbackSignature,
} from "@/lib/github-actions/callback-auth";
import { ACTIONS_WORKER_ID } from "@/lib/github-actions/dispatch-analysis";
import { getSandboxRun } from "@/lib/execution/sandbox-run-store";
import {
  completeSandboxRunFromWorker,
  type SandboxWorkerReport,
} from "@/lib/execution/sandbox-run-verification";
import type { SandboxRun } from "@/lib/execution/sandbox-run-types";
import type { RepositoryVerificationResult } from "@/lib/patch-kit/repository-verification";

export const runtime = "nodejs";
export const maxDuration = 30;

const EXPECTED_WORKFLOW = "RepoDiet sandbox validation worker";
const EXPECTED_REPOSITORY = "smokychain22/agentPass";

/**
 * Trusted Actions complete callback for sandbox patch validation.
 * Auth: WORKER_CALLBACK_SECRET + HMAC signature over workflow identity.
 * claimToken is resolved server-side from the durable run — never accepted
 * from the client (mirrors /api/internal/actions/deep-scans/[id]/ingest).
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertWorkerCallbackAuthorized(request);
  } catch (err) {
    if (err instanceof WorkerAuthError) {
      return NextResponse.json({ ok: false, code: err.code, error: err.message }, { status: 401 });
    }
    throw err;
  }

  const { id: runId } = await context.params;

  let body: {
    workerId?: string;
    claimToken?: string;
    claimHandle?: string;
    workflowRunId?: string;
    workflowRunAttempt?: string | number;
    workflowName?: string;
    repository?: string;
    completionNonce?: string;
    timestamp?: string;
    stage?: "passed" | "failed";
    resultDigest?: string;
    baseCommitSha?: string;
    validatedPaths?: string[];
    gitApplyExitCode?: number;
    gitApplyStderr?: string;
    patchHash?: string;
    gitVersion?: string;
    error?: string;
    repositoryVerification?: RepositoryVerificationResult;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, code: "INVALID_INPUT", error: "JSON body required." }, { status: 400 });
  }

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
  const stage = body.stage;

  if (!workflowRunId || !workflowRunAttempt || !completionNonce || !timestamp || !stage) {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_INPUT",
        error: "workflowRunId, workflowRunAttempt, completionNonce, timestamp, and stage are required.",
      },
      { status: 422 }
    );
  }

  const resultDigest =
    body.resultDigest ??
    createHash("sha256")
      .update(JSON.stringify({ stage, baseCommitSha: body.baseCommitSha, validatedPaths: body.validatedPaths ?? [] }))
      .digest("hex");

  const callbackPayload: ActionsCallbackPayload = {
    jobId: runId,
    workflowRunId,
    workflowRunAttempt,
    workflowName,
    repository,
    completionNonce,
    timestamp,
    resultDigest,
    stage,
  };

  const signature =
    request.headers.get("x-worker-callback-signature") || request.headers.get("x-repodiet-callback-signature");
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

  const run = await getSandboxRun(runId);
  if (!run) {
    return NextResponse.json({ ok: false, code: "SANDBOX_RUN_NOT_FOUND", error: "Sandbox run not found." }, { status: 404 });
  }

  const nonceOk = await consumeCompletionNonce(completionNonce, runId);
  if (!nonceOk) {
    // Idempotent replay: same run, same workflow — treat as already-handled.
    if (run.workflowRunId === workflowRunId) {
      return NextResponse.json({ ok: true, idempotent: true, status: run.status, runId });
    }
    return NextResponse.json(
      { ok: false, code: "COMPLETION_NONCE_REPLAY", error: "Completion nonce already used." },
      { status: 409 }
    );
  }

  try {
    assertWorkflowIdentity(run, {
      workflowRunId,
      workflowRunAttempt,
      workflowName,
      repository,
      claimHandle: body.claimHandle?.trim(),
    });
  } catch (err) {
    if (err instanceof ActionsCallbackAuthError) {
      return NextResponse.json({ ok: false, code: err.code, error: err.message }, { status: 409 });
    }
    throw err;
  }

  const claimToken = run.claimToken;
  if (!claimToken || !run.claimedBy) {
    return NextResponse.json(
      { ok: false, code: "CLAIM_LEASE_INVALID", error: "No server-side claim token for this run." },
      { status: 409 }
    );
  }

  const report: SandboxWorkerReport = {
    status: stage,
    baseCommitSha: body.baseCommitSha ?? "",
    validatedPaths: body.validatedPaths,
    gitApplyExitCode: body.gitApplyExitCode,
    gitApplyStderr: body.gitApplyStderr,
    patchHash: body.patchHash,
    gitVersion: body.gitVersion,
    error: body.error,
    workflowRunId,
    workflowRunUrl: run.workflowRunUrl,
    repositoryVerification: body.repositoryVerification,
  };

  // workerId is the wire-reported identity, deliberately NOT resolved from
  // `run.claimedBy` — completeSandboxRunFromWorker's ownership check would
  // otherwise compare the claim record against itself and never fail.
  const result = await completeSandboxRunFromWorker(runId, workerId, claimToken, report);
  if (!result.ok) {
    const status = result.code === "SANDBOX_RESULT_CONFLICT" ? 409 : result.code === "NOT_FOUND" ? 404 : 409;
    return NextResponse.json({ ok: false, code: result.code, error: result.message, runId }, { status });
  }

  return NextResponse.json({
    ok: true,
    idempotent: result.idempotent,
    status: result.run.status,
    runId,
    verifiedChanges: result.run.verifiedChanges,
  });
}

function assertWorkflowIdentity(
  run: SandboxRun,
  input: {
    workflowRunId: string;
    workflowRunAttempt: string;
    workflowName: string;
    repository: string;
    claimHandle?: string;
  }
): void {
  if (run.workflowRunId && run.workflowRunId !== input.workflowRunId) {
    throw new ActionsCallbackAuthError("WORKFLOW_IDENTITY_MISMATCH", "workflowRunId does not match the claimed run.");
  }
  if (run.workflowRunAttempt && run.workflowRunAttempt !== input.workflowRunAttempt) {
    throw new ActionsCallbackAuthError(
      "WORKFLOW_IDENTITY_MISMATCH",
      "workflowRunAttempt does not match the claimed run."
    );
  }
  if (run.workflowName && run.workflowName !== input.workflowName) {
    throw new ActionsCallbackAuthError("WORKFLOW_IDENTITY_MISMATCH", "workflowName does not match the claimed run.");
  }
  if (run.workflowRepository && run.workflowRepository !== input.repository) {
    throw new ActionsCallbackAuthError("WORKFLOW_IDENTITY_MISMATCH", "repository does not match the claimed run.");
  }
  if (input.repository !== EXPECTED_REPOSITORY) {
    throw new ActionsCallbackAuthError("WORKFLOW_IDENTITY_MISMATCH", "Unexpected Actions repository for RepoDiet worker.");
  }
  if (input.claimHandle && run.claimHandle && input.claimHandle !== run.claimHandle) {
    throw new ActionsCallbackAuthError("WORKFLOW_IDENTITY_MISMATCH", "claimHandle does not match the claimed run.");
  }
}
