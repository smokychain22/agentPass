import { NextResponse } from "next/server";
import {
  assertWorkerAuthorized,
  WorkerAuthError,
} from "@/lib/worker/worker-auth";
import { consumeDispatchNonce } from "@/lib/github-actions/dispatch-nonce-store";
import { ACTIONS_WORKER_ID } from "@/lib/github-actions/dispatch-analysis";
import {
  claimDeepScanJobById,
  failDeepScanArchivePreparation,
  getDeepScanJob,
  updateDeepScanStage,
} from "@/lib/deep-scan/job-store";
import { ACTIONS_ANALYSIS_LIMITS } from "@/lib/github-actions/limits";
import {
  ArchivePreparationError,
  buildArchiveDescriptor,
} from "@/lib/github-actions/archive-descriptor";
import { requiredRepositoryTargetFields } from "@/lib/repository/repository-target";
import { touchMarketplaceHealth } from "@/lib/okx/marketplace-telemetry";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Trusted Actions claim job exchanges dispatchNonce for claimToken + public archive URL.
 * Never logs secrets or private installation tokens.
 * Rejects incomplete repository identity before CLAIMED.
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

  const preClaim = await getDeepScanJob(jobId);
  if (!preClaim) {
    return NextResponse.json(
      { ok: false, code: "NOT_FOUND", error: "Deep-scan job not found." },
      { status: 404 }
    );
  }

  const identityMissing = requiredRepositoryTargetFields(
    preClaim.repositoryTarget ?? {
      repositoryOwner: preClaim.repositoryOwner,
      repositoryName: preClaim.repositoryName,
      repositoryFullName:
        preClaim.repositoryFullName ||
        (preClaim.repositoryOwner && preClaim.repositoryName
          ? `${preClaim.repositoryOwner}/${preClaim.repositoryName}`
          : undefined),
      repositoryUrl: preClaim.repositoryUrl || preClaim.request.repoUrl,
      branch: preClaim.branch || preClaim.request.branch,
      sourceCommit: preClaim.sourceCommit || preClaim.request.sourceCommit,
      projectRoot: preClaim.projectRoot || preClaim.request.projectRoot || ".",
      visibility: "public",
      archiveStrategy: "PUBLIC_ARCHIVE",
      provider: "github",
      githubInstallationId: null,
      createdAt: preClaim.createdAt,
    }
  );
  // Soft fields that may be synthesized from flat columns for legacy jobs.
  const criticalMissing = identityMissing.filter((f) =>
    ["repositoryOwner", "repositoryName", "sourceCommit", "branch", "projectRoot"].includes(f)
  );
  if (
    !preClaim.repositoryOwner?.trim() ||
    !preClaim.repositoryName?.trim() ||
    !(preClaim.sourceCommit || preClaim.request.sourceCommit)
  ) {
    await failDeepScanArchivePreparation(
      jobId,
      "REPOSITORY_IDENTITY_INCOMPLETE",
      `Repository identity incomplete before claim: ${criticalMissing.join(", ") || "owner/name/commit"}`,
      {
        terminal: true,
        workflowRunId: body.workflowRunId?.trim(),
        workflowRunUrl: body.workflowRunUrl?.trim(),
      }
    );
    return NextResponse.json(
      {
        ok: false,
        code: "REPOSITORY_IDENTITY_INCOMPLETE",
        retryable: false,
        missingFields: criticalMissing,
        error: "Repository identity incomplete — refusing to claim.",
        jobId,
      },
      { status: 422 }
    );
  }

  const nonce = await consumeDispatchNonce(dispatchNonce, jobId);
  if (!nonce) {
    const existing = await getDeepScanJob(jobId);
    if (
      existing?.claimedBy === workerId &&
      existing.claimToken &&
      existing.leaseExpiresAt &&
      Date.parse(existing.leaseExpiresAt) > Date.now()
    ) {
      try {
        const archive = buildArchiveDescriptor(existing);
        return NextResponse.json({
          ok: true,
          alreadyClaimed: true,
          code: "ALREADY_CLAIMED",
          claimToken: existing.claimToken,
          workerId,
          job: sanitizeJob(existing),
          archive,
          limits: ACTIONS_ANALYSIS_LIMITS,
        });
      } catch (err) {
        const code = err instanceof ArchivePreparationError ? err.code : "ARCHIVE_PREPARATION_FAILED";
        return NextResponse.json(
          { ok: false, code, error: err instanceof Error ? err.message : "Archive preparation failed." },
          { status: 422 }
        );
      }
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

  let archive;
  try {
    archive = buildArchiveDescriptor(claim.job);
    if (archive.strategy === "PUBLIC_ARCHIVE" && !archive.url) {
      throw new ArchivePreparationError(
        "ARCHIVE_PREPARATION_FAILED",
        "Public archive URL could not be constructed."
      );
    }
    if (archive.strategy === "GITHUB_APP_ARCHIVE") {
      throw new ArchivePreparationError(
        "PRIVATE_ARCHIVE_NOT_READY",
        "Private repository archive requires trusted GitHub App acquisition (not yet available on this runner)."
      );
    }
  } catch (err) {
    const code = err instanceof ArchivePreparationError ? err.code : "ARCHIVE_PREPARATION_FAILED";
    const message = err instanceof Error ? err.message : "Archive preparation failed.";
    await failDeepScanArchivePreparation(jobId, code, message, {
      workflowRunId: body.workflowRunId?.trim(),
      workflowRunUrl: body.workflowRunUrl?.trim(),
    });
    return NextResponse.json(
      {
        ok: false,
        code,
        error: message,
        status: "FAILED_RETRYABLE",
        jobId,
        workflowRunId: body.workflowRunId?.trim(),
        requiredAction: "Retry after repository identity is repaired.",
      },
      { status: 422 }
    );
  }

  const patch: Record<string, unknown> = {
    workflowRunId: body.workflowRunId?.trim() || claim.job.workflowRunId,
    workflowRunUrl: body.workflowRunUrl?.trim() || claim.job.workflowRunUrl,
    workerMode: "github_actions_on_demand",
    workerHost: "github-actions/ubuntu-latest",
    repositoryFullName:
      claim.job.repositoryFullName ||
      `${claim.job.repositoryOwner}/${claim.job.repositoryName}`,
    repositoryUrl: claim.job.repositoryUrl || claim.job.request.repoUrl,
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
      archive: {
        strategy: archive.strategy,
        repositoryFullName: archive.repositoryFullName,
        sourceCommit: archive.sourceCommit,
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
    archive,
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
    repositoryFullName: job.repositoryFullName,
    repositoryUrl: job.repositoryUrl,
    branch: job.branch,
    sourceCommit: job.sourceCommit,
    projectRoot: job.projectRoot,
    structureScanId: job.request.structureScanId,
    repoUrl: job.request.repoUrl,
    readOnly: job.request.readOnly !== false,
    workflowRunId: job.workflowRunId,
    workflowRunUrl: job.workflowRunUrl,
    analysisConfigDigest: job.analysisConfigDigest,
    repositoryTarget: job.repositoryTarget
      ? {
          provider: job.repositoryTarget.provider,
          repositoryFullName: job.repositoryTarget.repositoryFullName,
          branch: job.repositoryTarget.branch,
          sourceCommit: job.repositoryTarget.sourceCommit,
          visibility: job.repositoryTarget.visibility,
          archiveStrategy: job.repositoryTarget.archiveStrategy,
          projectRoot: job.repositoryTarget.projectRoot,
        }
      : undefined,
  };
}
