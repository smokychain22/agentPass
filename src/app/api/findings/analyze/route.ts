import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { getAppScan, storeAppScan } from "@/lib/scan/app-scan-store";
import { createDeepScanJob, updateDeepScanStage } from "@/lib/deep-scan/job-store";
import { isWorkerAvailable } from "@/lib/worker/worker-instance-store";
import { resolveTenantIdentity } from "@/lib/tenant/request-auth";
import { analysisError, createRequestId } from "@/lib/findings/analysis-errors";
import { ensureBrowserSessionId } from "@/lib/github-app/browser-session";
import {
  dispatchAnalysisWorkflow,
  isActionsDispatcherConfigured,
} from "@/lib/github-actions/dispatch-analysis";
import {
  analysisConfigDigest,
  createDispatchNonce,
  dispatchNonceTtlMs,
  storeDispatchNonce,
} from "@/lib/github-actions/dispatch-nonce-store";
import { touchMarketplaceHealth } from "@/lib/okx/marketplace-telemetry";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Durable findings analysis enqueue.
 * Returns HTTP 202 immediately — never runs Knip/jscpd/Madge in this request.
 */
export async function POST(request: Request) {
  const requestId = createRequestId();
  // Ensure browser session exists so subsequent polls share the same tenant binding.
  let sessionTenantId: string | undefined;
  try {
    const sessionId = await ensureBrowserSessionId();
    sessionTenantId = `browser:${sessionId}`;
  } catch {
    sessionTenantId = undefined;
  }
  const identity = resolveTenantIdentity(request);
  const tenantId = sessionTenantId ?? (identity.source !== "anonymous" ? identity.tenantId : undefined);

  let body: {
    structureScanId?: string;
    repoUrl?: string;
    branch?: string;
    sourceCommit?: string;
    projectRoot?: string;
    /** Ignored — tenant is server-derived. */
    tenantId?: string;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      analysisError({
        code: "INVALID_INPUT",
        message: "Request body must be valid JSON.",
        retryable: false,
        requestId,
        requiredAction: "SEND_JSON_BODY",
      }),
      { status: 400 }
    );
  }

  const structureScanId = body.structureScanId?.trim();
  if (!structureScanId) {
    return NextResponse.json(
      analysisError({
        code: "SCAN_NOT_FOUND",
        message: "structureScanId is required. Complete a structure scan before Run Findings.",
        retryable: false,
        requestId,
        requiredAction: "RUN_STRUCTURE_SCAN",
      }),
      { status: 422 }
    );
  }

  if (!tenantId) {
    return NextResponse.json(
      analysisError({
        code: "TENANT_FORBIDDEN",
        message: "Authenticated browser session is required to start findings analysis.",
        retryable: false,
        requestId,
        structureScanId,
        requiredAction: "AUTHENTICATE",
      }),
      { status: 401 }
    );
  }

  const scanRecord = await getAppScan(structureScanId);
  if (!scanRecord) {
    return NextResponse.json(
      analysisError({
        code: "SCAN_NOT_FOUND",
        message: "Structure scan not found.",
        retryable: false,
        requestId,
        structureScanId,
        requiredAction: "RUN_STRUCTURE_SCAN",
      }),
      { status: 404 }
    );
  }

  const scan = scanRecord.payload;
  const repoUrl = body.repoUrl?.trim() || scan.repo.url;
  const branch = body.branch?.trim() || scan.repo.branch;
  const sourceCommit = body.sourceCommit?.trim() || scan.repo.commitSha;
  const projectRoot =
    body.projectRoot?.trim() ||
    scan.repositoryModel?.primaryProjectRoot ||
    ".";

  if (!sourceCommit) {
    return NextResponse.json(
      analysisError({
        code: "SOURCE_COMMIT_MISMATCH",
        message: "Structure scan is missing a pinned source commit.",
        retryable: false,
        requestId,
        structureScanId,
        requiredAction: "RUN_STRUCTURE_SCAN",
      }),
      { status: 409 }
    );
  }

  if (body.sourceCommit?.trim() && body.sourceCommit.trim() !== scan.repo.commitSha) {
    return NextResponse.json(
      analysisError({
        code: "SOURCE_COMMIT_MISMATCH",
        message: "Requested source commit does not match the structure scan pin.",
        retryable: false,
        requestId,
        structureScanId,
        requiredAction: "RESCAN_REPOSITORY",
      }),
      { status: 409 }
    );
  }

  const expectedRepo = `${scan.repo.owner}/${scan.repo.name}`.toLowerCase();
  const requestedRepo = repoUrl.toLowerCase();
  if (
    !requestedRepo.includes(expectedRepo) &&
    body.repoUrl?.trim() &&
    body.repoUrl.trim() !== scan.repo.url
  ) {
    return NextResponse.json(
      analysisError({
        code: "SCAN_REPOSITORY_MISMATCH",
        message: "Repository does not match the structure scan.",
        retryable: false,
        requestId,
        structureScanId,
        requiredAction: "USE_MATCHING_SCAN",
      }),
      { status: 409 }
    );
  }

  // Bind/refresh tenant on the structure scan to this session (never trust body.tenantId).
  if (scanRecord.tenantId && scanRecord.tenantId !== tenantId) {
    return NextResponse.json(
      analysisError({
        code: "TENANT_FORBIDDEN",
        message: "Resource not found.",
        retryable: false,
        requestId,
        structureScanId,
        requiredAction: "USE_OWN_RESOURCE",
      }),
      { status: 404 }
    );
  }
  if (!scanRecord.tenantId) {
    await storeAppScan(structureScanId, {
      payload: scan,
      ownerKey: tenantId,
      tenantId,
    });
  }

  const dispatcherConfigured = isActionsDispatcherConfigured();
  const daemonReady = await isWorkerAvailable();
  const idempotencyKey = `findings:${tenantId}:${structureScanId}:${sourceCommit}:${projectRoot}`;
  const digest = analysisConfigDigest({
    tenantId,
    structureScanId,
    repository: expectedRepo,
    branch,
    sourceCommit,
    projectRoot,
  });

  let job = await createDeepScanJob(
    {
      repoUrl: scan.repo.url,
      branch,
      projectRoot,
      sourceCommit,
      readOnly: true,
      requestedBy: `tenant:${tenantId}`,
      tenantId,
      structureScanId,
    },
    { idempotencyKey }
  );

  // Ensure claim-time archive fields are populated even for idempotent re-enqueues
  // created before repositoryOwner/Name were written at job creation.
  if (!job.repositoryOwner || !job.repositoryName) {
    job =
      (await updateDeepScanStage(job.id, job.stage, job.progress?.detail, {
        repositoryOwner: scan.repo.owner,
        repositoryName: scan.repo.name,
        branch,
        sourceCommit,
        projectRoot,
      })) ?? job;
  }

  // Idempotent: already dispatched / running / ready — do not create another workflow.
  const alreadyActive =
    Boolean(job.workflowRunId) ||
    ["DISPATCHING", "DISPATCHED", "WAITING_FOR_RUNNER", "CLAIMED", "INVENTORY", "RESOLVING_PROJECTS", "BUILDING_GRAPH", "RUNNING_ANALYZERS", "NORMALIZING_FINDINGS", "VALIDATING_EVIDENCE", "READY", "COMPLETED"].includes(
      job.stage
    );

  let dispatchError: string | undefined;
  if (!alreadyActive && dispatcherConfigured) {
    await updateDeepScanStage(job.id, "DISPATCHING", "Requesting GitHub Actions analysis worker");
    const nonce = createDispatchNonce();
    const expiresAt = new Date(Date.now() + dispatchNonceTtlMs()).toISOString();
    await storeDispatchNonce({
      nonce,
      jobId: job.id,
      tenantId,
      requestId,
      createdAt: new Date().toISOString(),
      expiresAt,
    });

    const apiBaseUrl = (
      process.env.REPODIET_PUBLIC_API_BASE_URL?.trim() ||
      process.env.NEXT_PUBLIC_APP_URL?.trim() ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
      "https://skillswap-virid-kappa.vercel.app"
    ).replace(/\/$/, "");

    const environment =
      process.env.VERCEL_ENV === "preview" ? "preview" : "production";

    const dispatched = await dispatchAnalysisWorkflow({
      jobId: job.id,
      requestId,
      dispatchNonce: nonce,
      environment,
      apiBaseUrl,
    });

    if (dispatched.ok) {
      job =
        (await updateDeepScanStage(job.id, "DISPATCHED", "repository_dispatch accepted (HTTP 204)", {
          dispatchNonce: nonce,
          dispatchedAt: dispatched.dispatchedAt,
          workerMode: "github_actions_on_demand",
          analysisConfigDigest: digest,
          // Do not invent workflowRunId — claim job records github.run_id.
          workflowRunId: undefined,
          workflowRunUrl: undefined,
          resultSummary: {
            ...(job.resultSummary ?? {}),
            dispatch: {
              eventType: dispatched.eventType,
              dispatchNonceDigest: dispatched.dispatchNonceDigest,
              dispatchState: "DISPATCHED",
              dispatchRequestedAt: dispatched.dispatchedAt,
            },
          },
        })) ?? job;
      job =
        (await updateDeepScanStage(
          job.id,
          "WAITING_FOR_RUNNER",
          "Waiting for GitHub Actions runner"
        )) ?? job;
      await touchMarketplaceHealth({
        dispatcherReady: true,
        workerMode: "github_actions_on_demand",
        activeWorkflowRuns: 1,
        workerReady: true,
        workerReadySource: "github_actions_dispatcher",
      });
    } else {
      dispatchError = dispatched.message;
      job =
        (await updateDeepScanStage(job.id, "QUEUED", `Dispatch deferred: ${dispatched.code}`, {
          failureCode: dispatched.code,
          failureMessage: dispatched.message,
          dispatchNonce: nonce,
          workerMode: "github_actions_on_demand",
          analysisConfigDigest: digest,
        })) ?? job;
      await touchMarketplaceHealth({
        dispatcherReady: false,
        recentWorkerFailureRate: 1,
      });
    }
  } else if (!alreadyActive && !dispatcherConfigured && !daemonReady) {
    job =
      (await updateDeepScanStage(
        job.id,
        "QUEUED",
        "Queued — configure REPODIET_ACTIONS_DISPATCH_TOKEN to start free GitHub Actions workers",
        { workerMode: "github_actions_on_demand", analysisConfigDigest: digest }
      )) ?? job;
  }

  const statusUrl = `/api/deep-scans/${job.id}`;
  const correlation = nanoid(8);
  const dispatcherReady = dispatcherConfigured;
  const stage = job.stage;

  return NextResponse.json(
    {
      accepted: true,
      ok: true,
      jobId: job.id,
      taskId: job.id,
      status: stage === "QUEUED" ? "QUEUED" : stage,
      stage,
      statusUrl,
      progressUrl: statusUrl,
      workerReady: dispatcherReady || daemonReady,
      dispatcherReady,
      workerMode: "github_actions_on_demand",
      workflowRunId: job.workflowRunId,
      workflowRunUrl: job.workflowRunUrl,
      requestId,
      structureScanId,
      repository: expectedRepo,
      branch,
      sourceCommit,
      projectRoot,
      tenantId,
      correlationId: correlation,
      analysisConfigDigest: digest,
      message: dispatcherReady
        ? stage === "WAITING_FOR_RUNNER" || stage === "DISPATCHED"
          ? "Starting secure analysis worker on GitHub Actions."
          : "Findings analysis accepted for ephemeral GitHub Actions worker."
        : dispatchError
          ? `Job queued but Actions dispatch failed: ${dispatchError}`
          : "Findings analysis queued. Configure REPODIET_ACTIONS_DISPATCH_TOKEN to enable free GitHub Actions workers.",
      requiredAction: "POLL_STATUS",
    },
    { status: 202 }
  );
}
