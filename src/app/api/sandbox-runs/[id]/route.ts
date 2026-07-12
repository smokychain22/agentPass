import { NextResponse } from "next/server";
import { getSandboxRun, getSandboxRunByCleanupRunId } from "@/lib/execution/sandbox-run-store";
import { getStoredPatchKit } from "@/lib/patch-kit/patch-kit-store";
import {
  isTerminalSandboxStatus,
  reconcileSandboxRun,
} from "@/lib/execution/start-cleanup-workflow";

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

    run = await reconcileSandboxRun(run);
    const terminal = isTerminalSandboxStatus(run.status);
    const stored = await getStoredPatchKit(run.cleanupRunId);

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
      patchKit: stored?.payload,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load sandbox run.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
