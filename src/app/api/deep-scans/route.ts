import { NextResponse } from "next/server";
import { createDeepScanJob, DeepScanWorkerUnavailableError } from "@/lib/deep-scan/job-store";
import { after } from "next/server";
import { claimNextDeepScanJob } from "@/lib/deep-scan/job-store";
import { executeDeepScanJob } from "@/lib/deep-scan/execute";
import { isWorkerAvailable } from "@/lib/worker/worker-instance-store";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Enqueue a durable deep-scan job.
 * Immediate response — full analysis continues via worker claim or controlled executor.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    repoUrl?: string;
    branch?: string;
    projectRoot?: string;
    sourceCommit?: string;
    a2aTaskId?: string;
    readOnly?: boolean;
    idempotencyKey?: string;
    /** Dev/preview only: run executor in-process after enqueue when no worker heartbeat. */
    allowInlineExecutor?: boolean;
  };

  if (!body.repoUrl?.trim()) {
    return NextResponse.json({ ok: false, error: "repoUrl is required." }, { status: 422 });
  }

  try {
    const job = await createDeepScanJob(
      {
        repoUrl: body.repoUrl.trim(),
        branch: body.branch?.trim(),
        projectRoot: body.projectRoot?.trim(),
        sourceCommit: body.sourceCommit?.trim(),
        a2aTaskId: body.a2aTaskId?.trim(),
        readOnly: body.readOnly !== false,
        requestedBy: "api/deep-scans",
      },
      { idempotencyKey: body.idempotencyKey?.trim() }
    );

    const workerReady = await isWorkerAvailable();
    const allowInline =
      body.allowInlineExecutor === true &&
      !workerReady &&
      process.env.NODE_ENV !== "production";

    if (allowInline) {
      after(() => {
        void (async () => {
          const claimed = await claimNextDeepScanJob("inline-deep-scan");
          if (claimed && claimed.id === job.id) {
            await executeDeepScanJob(claimed.id, "inline-deep-scan");
          }
        })().catch((err) => {
          console.error("[deep-scan] inline executor failed", err);
        });
      });
    }

    return NextResponse.json({
      ok: true,
      jobId: job.id,
      status: job.status,
      stage: job.stage,
      progressUrl: `/api/deep-scans/${job.id}`,
      workerReady,
      message: workerReady
        ? "Deep scan queued for RepoDiet worker."
        : "Deep scan persisted. Waiting for RepoDiet worker heartbeat to claim — not executed solely via after().",
      note: "A2MCP Quick Triage remains bounded; this endpoint is for full durable analysis.",
    });
  } catch (err) {
    if (err instanceof DeepScanWorkerUnavailableError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to enqueue deep scan." },
      { status: 500 }
    );
  }
}
