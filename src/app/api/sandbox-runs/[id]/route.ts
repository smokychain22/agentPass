import { NextResponse } from "next/server";
import { getSandboxRun, getSandboxRunByCleanupRunId } from "@/lib/execution/sandbox-run-store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    let run = await getSandboxRun(id);
    if (!run) {
      run = await getSandboxRunByCleanupRunId(id);
    }
    if (!run) {
      return NextResponse.json({ ok: false, error: "Sandbox run not found." }, { status: 404 });
    }

    const terminal = ["delivered", "failed", "blocked", "timed_out", "ready_for_delivery"].includes(
      run.status
    );

    return NextResponse.json({
      ok: true,
      run: {
        id: run.id,
        cleanupRunId: run.cleanupRunId,
        workflowRunId: run.workflowRunId,
        sandboxId: run.sandboxId,
        status: run.status,
        progress: run.progress,
        statusHistory: run.statusHistory,
        failureCode: run.failureCode,
        failureMessage: run.failureMessage,
        result: run.result,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        completedAt: run.completedAt,
      },
      terminal,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load sandbox run.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
