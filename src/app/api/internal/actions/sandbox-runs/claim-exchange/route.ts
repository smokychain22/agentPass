import { NextResponse } from "next/server";
import {
  assertWorkerAuthorized,
  WorkerAuthError,
} from "@/lib/worker/worker-auth";
import { consumeDispatchNonce } from "@/lib/github-actions/dispatch-nonce-store";
import { ACTIONS_WORKER_ID } from "@/lib/github-actions/dispatch-analysis";
import {
  buildArchiveDescriptor,
  ArchivePreparationError,
} from "@/lib/github-actions/archive-descriptor";
import {
  claimSandboxRun,
  getSandboxRun,
  updateSandboxRun,
} from "@/lib/execution/sandbox-run-store";
import type { SandboxRun } from "@/lib/execution/sandbox-run-types";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Trusted Actions claim job for sandbox patch validation.
 * Exchanges a one-time dispatch nonce for a claimHandle + commit-pinned archive
 * descriptor + the exact edits to apply. Raw claimToken stays server-side —
 * never returned in this response (mirrors /api/internal/actions/claim-exchange).
 */
export async function POST(request: Request) {
  try {
    assertWorkerAuthorized(request);
  } catch (err) {
    if (err instanceof WorkerAuthError) {
      return NextResponse.json({ ok: false, code: err.code, error: err.message }, { status: 401 });
    }
    throw err;
  }

  let body: {
    runId?: string;
    dispatchNonce?: string;
    workerId?: string;
    workflowRunId?: string;
    workflowRunUrl?: string;
    workflowRunAttempt?: string;
    workflowName?: string;
    workflowRepository?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, code: "INVALID_INPUT", error: "JSON body required." }, { status: 400 });
  }

  const runId = body.runId?.trim();
  const dispatchNonce = body.dispatchNonce?.trim();
  const workerId = body.workerId?.trim() || ACTIONS_WORKER_ID;
  if (!runId || !dispatchNonce) {
    return NextResponse.json(
      { ok: false, code: "INVALID_INPUT", error: "runId and dispatchNonce are required." },
      { status: 422 }
    );
  }

  const preClaim = await getSandboxRun(runId);
  if (!preClaim) {
    return NextResponse.json({ ok: false, code: "NOT_FOUND", error: "Sandbox run not found." }, { status: 404 });
  }

  const nonce = await consumeDispatchNonce(dispatchNonce, runId);
  if (!nonce) {
    // Idempotent re-entry: this exact worker already holds a live claim.
    if (
      preClaim.claimedBy === workerId &&
      preClaim.claimHandle &&
      preClaim.leaseExpiresAt &&
      Date.parse(preClaim.leaseExpiresAt) > Date.now()
    ) {
      if (preClaim.payload.installationId) {
        return NextResponse.json(
          { ok: false, code: "PRIVATE_ARCHIVE_NOT_READY", error: "Private repository archive not available.", runId },
          { status: 422 }
        );
      }
      try {
        const archiveUrl = resolveArchiveUrl(preClaim);
        return buildClaimResponse(preClaim, workerId, true, archiveUrl);
      } catch (err) {
        const code = err instanceof ArchivePreparationError ? err.code : "ARCHIVE_PREPARATION_FAILED";
        const message = err instanceof Error ? err.message : "Archive preparation failed.";
        return NextResponse.json({ ok: false, code, error: message, runId }, { status: 422 });
      }
    }
    return NextResponse.json(
      { ok: false, code: "NONCE_INVALID", error: "Dispatch nonce missing, expired, or already used." },
      { status: 409 }
    );
  }

  const claim = await claimSandboxRun(runId, workerId);
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

  // Untrusted validate job never receives an installation token — private
  // repositories are not yet supported on this path (matches the existing
  // analysis worker's GITHUB_APP_ARCHIVE limitation).
  if (claim.run.payload.installationId) {
    return NextResponse.json(
      {
        ok: false,
        code: "PRIVATE_ARCHIVE_NOT_READY",
        error:
          "Private repository archive requires trusted GitHub App acquisition (not yet available on this runner).",
        runId,
      },
      { status: 422 }
    );
  }

  let archiveUrl: string;
  try {
    archiveUrl = resolveArchiveUrl(claim.run);
  } catch (err) {
    const code = err instanceof ArchivePreparationError ? err.code : "ARCHIVE_PREPARATION_FAILED";
    const message = err instanceof Error ? err.message : "Archive preparation failed.";
    return NextResponse.json({ ok: false, code, error: message, runId }, { status: 422 });
  }

  const updated = await updateSandboxRun(runId, {
    workflowRunId: body.workflowRunId?.trim(),
    workflowRunUrl: body.workflowRunUrl?.trim(),
    workflowRunAttempt: body.workflowRunAttempt?.trim(),
    workflowName: body.workflowName?.trim(),
    workflowRepository: body.workflowRepository?.trim(),
  });

  return buildClaimResponse(updated ?? claim.run, workerId, claim.alreadyClaimed, archiveUrl);
}

function resolveArchiveUrl(run: SandboxRun): string {
  const archive = buildArchiveDescriptor({
    repositoryOwner: run.repositoryOwner,
    repositoryName: run.repositoryName,
    repositoryFullName: `${run.repositoryOwner}/${run.repositoryName}`,
    branch: run.branch,
    sourceCommit: run.baseCommitSha,
    request: { repoUrl: run.payload.repoUrl, branch: run.branch, sourceCommit: run.baseCommitSha },
  });
  if (archive.strategy !== "PUBLIC_ARCHIVE" || !archive.url) {
    throw new ArchivePreparationError("ARCHIVE_PREPARATION_FAILED", "Public archive URL could not be constructed.");
  }
  return archive.url;
}

function buildClaimResponse(
  run: SandboxRun,
  workerId: string,
  alreadyClaimed: boolean,
  archiveUrl?: string
) {
  return NextResponse.json({
    ok: true,
    alreadyClaimed,
    claimHandle: run.claimHandle,
    workerId,
    runId: run.id,
    archiveUrl: archiveUrl ?? null,
    baseCommitSha: run.baseCommitSha,
    repositoryOwner: run.repositoryOwner,
    repositoryName: run.repositoryName,
    branch: run.branch,
    edits: run.payload.edits,
    changeOperations: run.payload.changeOperations.map((op) => ({ filePath: op.filePath, type: op.type })),
  });
}
