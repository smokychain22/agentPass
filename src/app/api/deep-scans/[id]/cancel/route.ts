import { NextResponse } from "next/server";
import { getDeepScanJob, updateDeepScanStage } from "@/lib/deep-scan/job-store";
import {
  denyUnlessTenantOwns,
  resolveTenantIdentity,
  tenantDenialResponse,
} from "@/lib/tenant/request-auth";
import { ensureBrowserSessionId } from "@/lib/github-app/browser-session";
import { createRequestId } from "@/lib/findings/analysis-errors";

export const runtime = "nodejs";

/** Cancel a queued/running deep-scan owned by the authenticated browser session. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const requestId = createRequestId();
  let sessionTenantId: string | undefined;
  try {
    const sessionId = await ensureBrowserSessionId();
    sessionTenantId = `browser:${sessionId}`;
  } catch {
    sessionTenantId = undefined;
  }
  const identity = resolveTenantIdentity(request);
  // Prefer cookie session — never trust free-form browser tenant headers as ownership.
  const tenantId = sessionTenantId ?? (identity.source === "session" ? identity.tenantId : undefined);
  if (!tenantId) {
    return NextResponse.json(
      {
        ok: false,
        code: "TENANT_FORBIDDEN",
        error: "Authenticated browser session is required to cancel analysis.",
        requestId,
      },
      { status: 401, headers: { "x-request-id": requestId } }
    );
  }

  const { id } = await context.params;
  const job = await getDeepScanJob(id);
  if (!job) {
    return NextResponse.json(
      { ok: false, code: "JOB_NOT_FOUND", error: "Deep scan job not found.", requestId },
      { status: 404, headers: { "x-request-id": requestId } }
    );
  }

  const denial = denyUnlessTenantOwns({
    resourceTenantId: job.tenantId ?? job.request.tenantId,
    requestTenantId: tenantId,
  });
  if (denial) {
    const response = tenantDenialResponse(denial, 404);
    return NextResponse.json(
      { ...response.body, requestId },
      { status: response.status, headers: { "x-request-id": requestId } }
    );
  }

  if (job.stage === "READY" || job.stage === "COMPLETED") {
    return NextResponse.json(
      {
        ok: false,
        code: "ALREADY_COMPLETE",
        error: "Cannot cancel a completed analysis.",
        requestId,
        jobId: job.id,
        status: job.status,
        stage: job.stage,
      },
      { status: 409, headers: { "x-request-id": requestId } }
    );
  }

  if (job.stage === "CANCELLED") {
    return NextResponse.json(
      {
        ok: true,
        alreadyTerminal: true,
        jobId: job.id,
        status: job.status,
        stage: job.stage,
        statusUrl: `/api/deep-scans/${job.id}`,
        requestId,
      },
      { headers: { "x-request-id": requestId } }
    );
  }

  const cancelled = await updateDeepScanStage(id, "CANCELLED", "Cancelled by operator");
  return NextResponse.json(
    {
      ok: true,
      cancelled: true,
      jobId: cancelled?.id ?? id,
      status: cancelled?.status ?? "failed",
      stage: cancelled?.stage ?? "CANCELLED",
      statusUrl: `/api/deep-scans/${id}`,
      requestId,
    },
    { headers: { "x-request-id": requestId } }
  );
}
