import { NextResponse } from "next/server";
import { getDeepScanJob } from "@/lib/deep-scan/job-store";
import {
  denyUnlessTenantOwns,
  resolveTenantIdentity,
  tenantDenialResponse,
} from "@/lib/tenant/request-auth";

export const runtime = "nodejs";
export const maxDuration = 20;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const job = await getDeepScanJob(id);
  if (!job) {
    return NextResponse.json({ ok: false, error: "Deep scan job not found." }, { status: 404 });
  }

  const identity = resolveTenantIdentity(request);
  const denial = denyUnlessTenantOwns({
    resourceTenantId: job.tenantId ?? job.request.tenantId,
    requestTenantId: identity.tenantId,
  });
  if (denial) {
    const response = tenantDenialResponse(denial, 404);
    return NextResponse.json(response.body, { status: response.status });
  }

  return NextResponse.json({
    ok: true,
    job: {
      id: job.id,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      tenantId: job.tenantId ?? job.request.tenantId,
      repositoryOwner: job.repositoryOwner,
      repositoryName: job.repositoryName,
      branch: job.branch,
      sourceCommit: job.sourceCommit,
      projectRoot: job.projectRoot,
      scanId: job.scanId,
      findingsId: job.findingsId,
      graphId: job.graphId,
      coverage: job.coverage,
      baseline: job.baseline,
      resultSummary: job.resultSummary,
      failureCode: job.failureCode,
      failureMessage: job.failureMessage,
      claimedBy: job.claimedBy,
      claimToken: job.claimToken ? "[redacted]" : undefined,
      workerHost: job.workerHost,
      claimedAt: job.claimedAt,
      heartbeatAt: job.heartbeatAt,
      leaseExpiresAt: job.leaseExpiresAt,
      attemptCount: job.attemptCount,
      statusHistory: job.statusHistory,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt,
    },
  });
}
