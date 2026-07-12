import {
  completeSandboxRun,
  failSandboxRun,
  getSandboxRun,
  updateSandboxRun,
} from "@/lib/execution/sandbox-run-store";
import type { SandboxRunPayload } from "@/lib/execution/sandbox-run-types";
import { executeRepositoryCleanup } from "@/lib/execution/repository-executor";
import { persistSandboxResultsToPatchKit } from "@/lib/execution/persist-sandbox-results";

export async function runSandboxExecutionStep(runId: string): Promise<void> {
  "use step";

  const run = await getSandboxRun(runId);
  if (!run) {
    throw new Error("SANDBOX_RUN_NOT_FOUND");
  }

  await updateSandboxRun(runId, { status: "starting", progress: "Starting sandbox execution" });

  try {
    const result = await executeRepositoryCleanup(runId, run.payload);
    const terminalStatus =
      result.repositoryVerification.status === "verified" ? "ready_for_delivery" : "blocked";

    await completeSandboxRun(
      runId,
      {
        patchValidation: result.patchValidation,
        repositoryVerification: result.repositoryVerification,
        gitVersion: result.gitVersion,
        nodeVersion: result.nodeVersion,
        npmVersion: result.npmVersion,
        patchHash: result.patchHash,
        sandboxId: result.sandboxId,
        logs: result.logs,
      },
      terminalStatus
    );

    await persistSandboxResultsToPatchKit({
      cleanupRunId: run.cleanupRunId,
      patchValidation: result.patchValidation,
      repositoryVerification: result.repositoryVerification,
      sandboxRunId: runId,
      workflowRunId: run.workflowRunId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sandbox execution failed";
    await failSandboxRun(
      runId,
      message.includes("SANDBOX_UNAVAILABLE") ? "SANDBOX_UNAVAILABLE" : "SANDBOX_EXECUTION_FAILED",
      message
    );
    throw err;
  }
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
