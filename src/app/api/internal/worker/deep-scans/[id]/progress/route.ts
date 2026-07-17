import { NextResponse } from "next/server";
import { assertWorkerAuthorized, WorkerAuthError } from "@/lib/worker/worker-auth";
import {
  failDeepScanJob,
  getDeepScanJob,
  heartbeatDeepScanJob,
  updateDeepScanStage,
} from "@/lib/deep-scan/job-store";
import type { DeepScanStage } from "@/lib/deep-scan/types";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertWorkerAuthorized(request);
    const { id } = await context.params;
    const body = (await request.json()) as {
      workerId?: string;
      stage?: DeepScanStage;
      detail?: string;
      failureCode?: string;
      failureMessage?: string;
    };
    const workerId = body.workerId?.trim();
    if (!workerId) {
      return NextResponse.json({ ok: false, error: "workerId is required." }, { status: 400 });
    }

    const existing = await getDeepScanJob(id);
    if (!existing) {
      return NextResponse.json({ ok: false, error: "Deep scan job not found." }, { status: 404 });
    }

    if (body.stage === "FAILED" || body.failureCode) {
      const failed = await failDeepScanJob(
        id,
        body.failureCode ?? "WORKER_EXECUTION_FAILED",
        body.failureMessage ?? body.detail ?? "Worker reported failure"
      );
      return NextResponse.json({ ok: true, job: failed });
    }

    await heartbeatDeepScanJob(id, workerId, body.detail);
    if (body.stage) {
      const updated = await updateDeepScanStage(id, body.stage, body.detail);
      return NextResponse.json({ ok: true, job: updated });
    }

    const job = await getDeepScanJob(id);
    return NextResponse.json({ ok: true, job });
  } catch (err) {
    if (err instanceof WorkerAuthError) {
      return NextResponse.json({ ok: false, code: err.code, error: err.message }, { status: 401 });
    }
    const message = err instanceof Error ? err.message : "Progress update failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
