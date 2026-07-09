import { NextResponse } from "next/server";
import { buildHealthResponse } from "@/lib/a2mcp/tool-manifest";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(buildHealthResponse(), {
    headers: { "Content-Type": "application/json" },
  });
}
