import { NextResponse } from "next/server";
import { assertWorkerAuthorized, WorkerAuthError } from "@/lib/worker/worker-auth";
import { claimNextDeepScanJob } from "@/lib/deep-scan/job-store";
import { setWorkerStatus } from "@/lib/worker/worker-instance-store";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Atomically claim the next deep-scan job for an always-on worker.
 * Default execute=false — the worker process must run analysis outside Vercel.
 */
export async function POST(request: Request) {
  try {
    assertWorkerAuthorized(request);
    const body = (await request.json().catch(() => ({}))) as {
      workerId?: string;
      execute?: boolean;
    };
    const workerId = body.workerId?.trim() || `worker_${Date.now()}`;
    const claimed = await claimNextDeepScanJob(workerId);
    if (!claimed) {
      return NextResponse.json({ ok: true, job: null });
    }
    await setWorkerStatus(workerId, "busy", claimed.id);

    // Never run full deep-scan inside this route by default.
    // execute:true remains available only for controlled diagnostics outside production.
    if (body.execute === true && process.env.VERCEL_ENV !== "production") {
      const { executeDeepScanJob } = await import("@/lib/deep-scan/execute");
      const completed = await executeDeepScanJob(claimed.id, workerId, {
        alreadyClaimed: true,
        claimToken: claimed.claimToken,
      });
      await setWorkerStatus(workerId, "online");
      return NextResponse.json({ ok: true, job: completed ?? claimed });
    }

    return NextResponse.json({ ok: true, job: claimed });
  } catch (err) {
    if (err instanceof WorkerAuthError) {
      return NextResponse.json({ ok: false, code: err.code, error: err.message }, { status: 401 });
    }
    const message = err instanceof Error ? err.message : "Deep scan claim failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
