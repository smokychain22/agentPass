import { NextResponse } from "next/server";
import { getStoredFindings } from "@/lib/findings/findings-store";
import {
  denyUnlessTenantOwns,
  resolveTenantIdentity,
  tenantDenialResponse,
} from "@/lib/tenant/request-auth";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ scanId: string }> }
) {
  const { scanId } = await params;
  const findings = await getStoredFindings(scanId);

  if (!findings) {
    return NextResponse.json(
      { success: false, error: "Findings not found for this scan ID." },
      { status: 404 }
    );
  }

  const identity = resolveTenantIdentity(request);
  const resourceTenantId =
    (findings as { tenantId?: string }).tenantId ||
    (findings as { meta?: { tenantId?: string } }).meta?.tenantId;

  const denial = denyUnlessTenantOwns({
    resourceTenantId,
    requestTenantId: identity.tenantId,
  });
  if (denial) {
    const response = tenantDenialResponse(denial, 404);
    return NextResponse.json(response.body, { status: response.status });
  }

  return NextResponse.json({ success: true, findings });
}
