import { NextResponse } from "next/server";
import { buildToolsIndex } from "@/lib/a2mcp/tool-manifest";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(buildToolsIndex(), {
    headers: { "Content-Type": "application/json" },
  });
}
