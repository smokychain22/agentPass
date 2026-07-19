import { NextResponse } from "next/server";
import { REPOSITORY_SUPPORT_MATRIX } from "@/lib/product/support-matrix";
import { PRODUCT_CAPABILITY_MATRIX } from "@/lib/product/capability-matrix";
import { PUBLIC_CAPACITY_LIMITS } from "@/lib/product/capacity-limits";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    support: REPOSITORY_SUPPORT_MATRIX,
    capabilities: PRODUCT_CAPABILITY_MATRIX,
    capacity: PUBLIC_CAPACITY_LIMITS,
    marketplace: {
      multiTenant: true,
      repositoryAllowlist: false,
      ownerWalletBypass: false,
      supportedCustomerJourney:
        "Any OKX buyer → any authorized GitHub repository → durable analysis → approved cleanup PR",
    },
  });
}
