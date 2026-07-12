import { NextResponse } from "next/server";
import { assertWorkerAuthorized, WorkerAuthError } from "@/lib/worker/worker-auth";
import { runSandboxExecutionOnce } from "@/lib/execution/execute-sandbox-run";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    assertWorkerAuthorized(request);
    const body = (await request.json()) as { runId?: string };
    const runId = body.runId?.trim();
    if (!runId) {
      return NextResponse.json({ ok: false, error: "runId is required." }, { status: 400 });
    }

    await runSandboxExecutionOnce(runId);
    return NextResponse.json({ ok: true, runId });
  } catch (err) {
    if (err instanceof WorkerAuthError) {
      return NextResponse.json({ ok: false, code: err.code, error: err.message }, { status: 401 });
    }
    const message = err instanceof Error ? err.message : "Sandbox execution failed.";
    return NextResponse.json(
      {
        ok: false,
        code: message.includes("SANDBOX") ? "SANDBOX_UNAVAILABLE" : "SANDBOX_EXECUTION_FAILED",
        error: message,
      },
      { status: 500 }
    );
  }
}
