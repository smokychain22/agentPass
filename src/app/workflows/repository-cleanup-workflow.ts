import type { SandboxRunPayload } from "@/lib/execution/sandbox-run-types";
import { prepareSandboxRunStep, runSandboxExecutionStep } from "@/lib/execution/cleanup-workflow-steps";

export async function repositoryCleanupWorkflow(runId: string, payload: SandboxRunPayload) {
  "use workflow";

  await prepareSandboxRunStep(runId, payload);
  await runSandboxExecutionStep(runId);

  return { runId, status: "completed" };
}
