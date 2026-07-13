import { NextResponse } from "next/server";
import { buildOkxReadinessResponse } from "@/lib/okx/readiness";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(buildOkxReadinessResponse());
}
