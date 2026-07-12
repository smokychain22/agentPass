import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** @deprecated Use POST /api/sandbox-runs/retry */
export async function POST(request: Request) {
  const body = (await request.json()) as { cleanupRunId?: string };
  const cleanupRunId = body.cleanupRunId?.trim();
  if (!cleanupRunId) {
    return NextResponse.json({ ok: false, error: "cleanupRunId is required." }, { status: 400 });
  }

  const origin = new URL(request.url).origin;
  const response = await fetch(`${origin}/api/sandbox-runs/retry`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cleanupRunId }),
  });
  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}
