import { NextResponse } from "next/server";
import { claimNextRepositoryJob } from "@/lib/worker/repository-job-store";
import { assertWorkerAuthorized } from "@/lib/worker/worker-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertWorkerAuthorized(request);
    const body = (await request.json()) as { workerId?: string };
    const workerId = body.workerId?.trim() ?? `worker_${Date.now()}`;
    const job = await claimNextRepositoryJob(workerId);
    if (!job) {
      return NextResponse.json({ ok: true, job: null });
    }
    return NextResponse.json({ ok: true, job });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Claim failed.";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message.includes("Unauthorized") ? 401 : 500 }
    );
  }
}
