import { NextResponse } from "next/server";
import { claimNextRepositoryJob } from "@/lib/worker/repository-job-store";
import { assertWorkerAuthorized, WorkerAuthError } from "@/lib/worker/worker-auth";
import { setWorkerStatus } from "@/lib/worker/worker-instance-store";

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
    await setWorkerStatus(workerId, "busy", job.id);
    return NextResponse.json({ ok: true, job });
  } catch (err) {
    if (err instanceof WorkerAuthError) {
      return NextResponse.json({ ok: false, code: err.code, error: err.message }, { status: 401 });
    }
    const message = err instanceof Error ? err.message : "Claim failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
