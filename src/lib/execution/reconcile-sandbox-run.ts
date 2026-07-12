import { getSandboxRun } from "@/lib/execution/sandbox-run-store";
import type { SandboxRun } from "@/lib/execution/sandbox-run-types";
import { isTerminalSandboxStatus } from "@/lib/execution/sandbox-run-store";
import { dispatchSandboxExecution } from "@/lib/execution/dispatch-sandbox-execution";
import {
  persistSandboxFailureToPatchKit,
  persistSandboxResultsToPatchKit,
} from "@/lib/execution/persist-sandbox-results";

export { isTerminalSandboxStatus };

export async function reconcileSandboxRun(run: SandboxRun): Promise<SandboxRun> {
  if (run.result && isTerminalSandboxStatus(run.status)) {
    const patchValidation = run.result.patchValidation;
    const repositoryVerification = run.result.repositoryVerification;
    if (patchValidation && repositoryVerification) {
      await persistSandboxResultsToPatchKit({
        cleanupRunId: run.cleanupRunId,
        patchValidation,
        repositoryVerification,
        sandboxRunId: run.id,
        workflowRunId: run.workflowRunId,
      });
    }
    return run;
  }

  if (run.status === "failed" && run.failureCode && run.failureMessage) {
    await persistSandboxFailureToPatchKit({
      cleanupRunId: run.cleanupRunId,
      failureCode: run.failureCode,
      failureMessage: run.failureMessage,
      sandboxRunId: run.id,
    });
    return run;
  }

  await dispatchSandboxExecution(run.id, run.payload);
  const refreshed = await getSandboxRun(run.id);
  return refreshed ?? run;
}
