import { NextResponse } from "next/server";
import { buildProductionReadinessResponse } from "@/lib/okx/production-readiness";

export const runtime = "nodejs";

/**
 * Honest production readiness — ready:true only with required live probes + evidence.
 */
export async function GET() {
  const body = await buildProductionReadinessResponse();
  return NextResponse.json(body, {
    status: body.ready ? 200 : 503,
  });
}
