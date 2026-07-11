import { NextResponse } from "next/server";
import { buildAgentCard } from "@/lib/a2a/agent-card";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(buildAgentCard(), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
    },
  });
}
