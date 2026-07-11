import { NextResponse } from "next/server";
import { checkEntitlement, resolveEntitlementMode } from "@/lib/entitlement/service";

export const runtime = "nodejs";

export async function GET() {
  const mode = resolveEntitlementMode();
  const quickCleanup = checkEntitlement({ toolKey: "quick_cleanup" });
  return NextResponse.json({
    success: true,
    mode,
    quickCleanup: {
      allowed: quickCleanup.allowed,
      reason: quickCleanup.reason,
    },
  });
}
