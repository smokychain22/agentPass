import { NextResponse } from "next/server";
import {
  assertWorkerAuthorized,
  WorkerAuthError,
} from "@/lib/worker/worker-auth";
import { getDeepScanJob, updateDeepScanStage } from "@/lib/deep-scan/job-store";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Operator disposition for legacy always-on-worker queued jobs.
 * Does not require a claim token — Worker API key only.
 * Preserves history; marks CANCELLED with SUPERSEDED_LEGACY_WORKER.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertWorkerAuthorized(request);
  } catch (err) {
    if (err instanceof WorkerAuthError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message },
        { status: 401 }
      );
    }
    throw err;
  }

  const { id: jobId } = await context.params;
  const job = await getDeepScanJob(jobId);
  if (!job) {
    return NextResponse.json(
      { ok: false, code: "JOB_NOT_FOUND", error: "Deep-scan job not found." },
      { status: 404 }
    );
  }

  if (job.stage === "READY" || job.stage === "COMPLETED") {
    return NextResponse.json(
      {
        ok: false,
        code: "ALREADY_COMPLETE",
        error: "Cannot supersede a completed job.",
        jobId,
        stage: job.stage,
      },
      { status: 409 }
    );
  }

  if (job.stage === "CANCELLED") {
    return NextResponse.json({
      ok: true,
      alreadyTerminal: true,
      jobId,
      stage: job.stage,
    });
  }

  const updated = await updateDeepScanStage(
    jobId,
    "CANCELLED",
    "Superseded: legacy always-on worker job — not dispatched to GitHub Actions",
    {
      failureCode: "SUPERSEDED_LEGACY_WORKER",
      failureMessage:
        "Superseded under GitHub Actions on-demand worker migration. Incident history preserved.",
      workerMode: job.workerMode ?? "unset",
    }
  );

  return NextResponse.json({
    ok: true,
    superseded: true,
    jobId,
    stage: updated?.stage ?? "CANCELLED",
    status: updated?.status,
  });
}
