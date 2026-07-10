import { NextResponse } from "next/server";
import { buildOkxHealthResponse } from "@/lib/okx/health";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(buildOkxHealthResponse());
}
