import { NextResponse } from "next/server";
import { getAppScan } from "@/lib/scan/app-scan-store";
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
  const record = await getAppScan(scanId);
  if (!record) {
    return NextResponse.json({ success: false, error: "Scan not found." }, { status: 404 });
  }

  const identity = resolveTenantIdentity(request);
  const resourceTenantId =
    record.tenantId ||
    (typeof record.payload === "object" &&
    record.payload &&
    "tenantId" in record.payload &&
    typeof (record.payload as { tenantId?: string }).tenantId === "string"
      ? (record.payload as { tenantId: string }).tenantId
      : undefined);
  // Do not treat IP-based ownerKey as a tenant id — that caused false 404s after session binding.

  const denial = denyUnlessTenantOwns({
    resourceTenantId,
    requestTenantId: identity.tenantId,
  });
  if (denial) {
    const response = tenantDenialResponse(denial, 404);
    return NextResponse.json(response.body, { status: response.status });
  }

  return NextResponse.json({ success: true, scan: record.payload });
}
