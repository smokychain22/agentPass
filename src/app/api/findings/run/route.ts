import { NextResponse } from "next/server";
import { scanRepository } from "@/lib/execution";
import { FindingsRunBodySchema } from "@/lib/findings/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = FindingsRunBodySchema.parse(await request.json());
    const findings = await scanRepository(body.repoUrl, body.branch);

    return NextResponse.json({ success: true, findings });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Findings analysis failed.";
    return NextResponse.json({ success: false, error: message }, { status: 422 });
  }
}
