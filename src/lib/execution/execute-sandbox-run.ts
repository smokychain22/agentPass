import {
  completeSandboxRun,
  failSandboxRun,
  getSandboxRun,
  isTerminalSandboxStatus,
} from "@/lib/execution/sandbox-run-store";
import { executeRepositoryCleanup } from "@/lib/execution/repository-executor";
import {
  persistSandboxFailureToPatchKit,
  persistSandboxResultsToPatchKit,
} from "@/lib/execution/persist-sandbox-results";

const ACTIVE_STATUSES = new Set([
  "creating_sandbox",
  "cloning",
  "baseline_verification",
  "applying_operations",
  "generating_patch",
  "git_validation",
  "patched_verification",
  "persisting_results",
]);

/** Active sandbox runs older than this may be re-executed (serverless timeout recovery). */
export const STALE_ACTIVE_SANDBOX_MS = 5 * 60 * 1000;

export function isActiveSandboxStatus(status: string): boolean {
  return ACTIVE_STATUSES.has(status);
}

export function isStaleActiveSandboxRun(run: { status: string; updatedAt: string }): boolean {
  if (!isActiveSandboxStatus(run.status)) return false;
  return Date.now() - new Date(run.updatedAt).getTime() >= STALE_ACTIVE_SANDBOX_MS;
}

export async function runSandboxExecutionOnce(runId: string): Promise<void> {
  const run = await getSandboxRun(runId);
  if (!run) {
    throw new Error("SANDBOX_RUN_NOT_FOUND");
  }
  if (isTerminalSandboxStatus(run.status)) {
    return;
  }
  if (isActiveSandboxStatus(run.status) && !isStaleActiveSandboxRun(run)) {
    return;
  }

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
    const failureCode = message.includes("GITHUB_REPOSITORY_NOT_GRANTED")
      ? "GITHUB_REPOSITORY_NOT_GRANTED"
      : message.includes("SANDBOX")
        ? "SANDBOX_UNAVAILABLE"
        : "SANDBOX_EXECUTION_FAILED";

    await failSandboxRun(runId, failureCode, message);
    await persistSandboxFailureToPatchKit({
      cleanupRunId: run.cleanupRunId,
      failureCode,
      failureMessage: message,
      sandboxRunId: runId,
    });
    throw err;
  }
}
