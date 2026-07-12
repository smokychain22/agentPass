import { runSandboxExecutionOnce } from "@/lib/execution/execute-sandbox-run";
import { updateSandboxRun, getSandboxRun } from "@/lib/execution/sandbox-run-store";
import type { SandboxRunPayload } from "@/lib/execution/sandbox-run-types";

export async function runSandboxExecutionStep(runId: string): Promise<void> {
  "use step";

  const run = await getSandboxRun(runId);
  if (!run) {
    throw new Error("SANDBOX_RUN_NOT_FOUND");
  }

  await updateSandboxRun(runId, { status: "starting", progress: "Starting sandbox execution" });
  await runSandboxExecutionOnce(runId);
}

export async function prepareSandboxRunStep(
  runId: string,
  payload: SandboxRunPayload
): Promise<void> {
  "use step";
  await updateSandboxRun(runId, {
    status: "resolving_repository",
    progress: "Resolving repository metadata",
    payload,
  });
}
