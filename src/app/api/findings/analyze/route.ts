import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { getAppScan, storeAppScan } from "@/lib/scan/app-scan-store";
import { createDeepScanJob } from "@/lib/deep-scan/job-store";
import { isWorkerAvailable } from "@/lib/worker/worker-instance-store";
import { resolveTenantIdentity } from "@/lib/tenant/request-auth";
import { analysisError, createRequestId } from "@/lib/findings/analysis-errors";
import { ensureBrowserSessionId } from "@/lib/github-app/browser-session";

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

  const workerReady = await isWorkerAvailable();
  const idempotencyKey = `findings:${tenantId}:${structureScanId}:${sourceCommit}:${projectRoot}`;

  const job = await createDeepScanJob(
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

  const statusUrl = `/api/deep-scans/${job.id}`;
  const correlation = nanoid(8);

  return NextResponse.json(
    {
      accepted: true,
      ok: true,
      jobId: job.id,
      taskId: job.id,
      status: "QUEUED",
      stage: job.stage === "QUEUED" || job.status === "queued" ? "QUEUED" : job.stage,
      statusUrl,
      progressUrl: statusUrl,
      workerReady,
      requestId,
      structureScanId,
      repository: expectedRepo,
      branch,
      sourceCommit,
      projectRoot,
      tenantId,
      correlationId: correlation,
      message: workerReady
        ? "Findings analysis queued for the RepoDiet worker."
        : "Findings analysis is queued and waiting for an analysis worker. The structure scan is preserved.",
      requiredAction: workerReady
        ? "POLL_STATUS"
        : "The task is safely queued and will continue when a worker becomes available.",
    },
    { status: 202 }
  );
}
