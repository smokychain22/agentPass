import { NextResponse } from "next/server";
import { runFindingsCategory } from "@/lib/findings/findings-engine";
import { FindingsRunBodySchema } from "@/lib/findings/types";

export const runtime = "nodejs";
export const maxDuration = 300;

async function handleTool(request: Request, category: Parameters<typeof runFindingsCategory>[2]) {
  try {
    const body = FindingsRunBodySchema.parse(await request.json());
    const findings = await runFindingsCategory(body.repoUrl, body.branch, category);
    return NextResponse.json({ success: true, findings });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Tool execution failed.";
    return NextResponse.json({ success: false, error: message }, { status: 422 });
  }
}

export async function POST(request: Request) {
  return handleTool(request, "duplicates");
}
