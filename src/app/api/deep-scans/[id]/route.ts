import { NextResponse } from "next/server";
import { getDeepScanJob } from "@/lib/deep-scan/job-store";
import { toPublicDeepScanDto } from "@/lib/deep-scan/public-dto";
import { reconcileParentTaskFromScan } from "@/lib/a2a/reconcile-parent-from-scan";
import {
  denyUnlessTenantOwns,
  resolveTenantIdentity,
  tenantDenialResponse,
} from "@/lib/tenant/request-auth";

export const runtime = "nodejs";
export const maxDuration = 20;

/**
 * Progress for a deep-scan job.
 * A2A acknowledgements advertise `/api/deep-scans/{id}` to anonymous customers —
 * when the job is bound to an a2aTaskId, that opaque id is the access grant
 * (same as knowing the task status URL). Tenant mismatch still 404s otherwise.
 *
 * Public responses NEVER include dispatchToken, claimToken, leaseToken, or other
 * internal worker secrets.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const job = await getDeepScanJob(id);
  if (!job) {
    return NextResponse.json(
      { ok: false, error: "Deep scan job not found.", code: "TASK_NOT_FOUND" },
      { status: 404 }
    );
  }

  const identity = resolveTenantIdentity(request);
  const a2aBound = Boolean(job.request.a2aTaskId);
  const resourceTenant = job.tenantId ?? job.request.tenantId;
  const allowA2aProgress =
    a2aBound &&
    (identity.source === "anonymous" ||
      identity.tenantId === "anonymous_public_readonly" ||
      (typeof resourceTenant === "string" && resourceTenant.startsWith("a2a:")));

  if (!allowA2aProgress) {
    const denial = denyUnlessTenantOwns({
      resourceTenantId: resourceTenant,
      requestTenantId: identity.tenantId,
    });
    if (denial) {
      const response = tenantDenialResponse(denial, 404);
      return NextResponse.json(response.body, { status: response.status });
    }
  }

  // Repair path: if child is terminal and parent exists, reconcile once.
  if (job.request.a2aTaskId) {
    try {
      await reconcileParentTaskFromScan(job.request.a2aTaskId, job.id, {
        actor: "status_poll",
      });
    } catch (err) {
      console.error("[deep-scan-progress] parent reconcile failed", job.id, err);
    }
  }

  return NextResponse.json(toPublicDeepScanDto(job), {
    headers: { "Cache-Control": "no-store" },
  });
}
