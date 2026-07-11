import { NextResponse } from "next/server";
import { retryRepositoryJob } from "@/lib/worker/repository-job-store";
import { isWorkerAvailable } from "@/lib/worker/worker-instance-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { cleanupRunId?: string; jobId?: string };
    const cleanupRunId = body.cleanupRunId?.trim();
    if (!cleanupRunId) {
      return NextResponse.json({ ok: false, error: "cleanupRunId is required." }, { status: 400 });
    }

    if (!(await isWorkerAvailable())) {
      return NextResponse.json(
        { ok: false, code: "WORKER_UNAVAILABLE", error: "No Docker worker heartbeat in the last 30 seconds." },
        { status: 503 }
      );
    }

    const job = await retryRepositoryJob(cleanupRunId);
    if (!job) {
      return NextResponse.json({ ok: false, error: "No retryable job for cleanup run." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, job });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Retry failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
