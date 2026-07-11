import { executeRepositoryCleanup } from "@/lib/execution/repository-executor";
import {
  completeSandboxRun,
  failSandboxRun,
  getSandboxRun,
  updateSandboxRun,
} from "@/lib/execution/sandbox-run-store";
import { getStoredPatchKit, storePatchKit } from "@/lib/patch-kit/patch-kit-store";
import { buildCleanupRunSummary } from "@/lib/patch-kit/cleanup-summary";
import type { SandboxRunPayload } from "@/lib/execution/sandbox-run-types";

export async function runSandboxExecutionStep(runId: string): Promise<void> {
  "use step";

  const run = await getSandboxRun(runId);
  if (!run) {
    throw new Error("SANDBOX_RUN_NOT_FOUND");
  }

  await updateSandboxRun(runId, { status: "starting", progress: "Starting sandbox execution" });

  try {
    const result = await executeRepositoryCleanup(runId, run.payload);
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
      result.repositoryVerification.status === "verified" ? "ready_for_delivery" : "blocked"
    );

    const stored = await getStoredPatchKit(run.cleanupRunId);
    if (stored?.payload) {
      const repositoryVerification = result.repositoryVerification;
      const patchValidation = result.patchValidation;
      const cleanupRunSummary = buildCleanupRunSummary({
        findings: stored.payload.artifacts.findingsJson!,
        summary: stored.payload.summary,
        candidateAudits: stored.payload.candidateAudits,
        changeOperations: stored.payload.changeOperations,
        verification: repositoryVerification,
      });

      const payload = {
        ...stored.payload,
        patchValidation,
        repositoryVerification,
        sandboxRunId: runId,
        workflowRunId: run.workflowRunId,
        cleanupRunSummary,
        summary: {
          ...stored.payload.summary,
          patchValidationStatus: patchValidation.status,
          generatedChanges: cleanupRunSummary.generatedOperations,
          generatedFileOperations: cleanupRunSummary.generatedOperations,
          contentValidatedOperations: cleanupRunSummary.contentValidatedOperations,
          gitValidatedOperations: cleanupRunSummary.gitValidatedOperations,
          validatedChanges: cleanupRunSummary.gitValidatedOperations,
          validatedFileOperations: cleanupRunSummary.gitValidatedOperations,
          verifiedChanges: cleanupRunSummary.verifiedOperations,
          verifiedFileOperations: cleanupRunSummary.verifiedOperations,
          deliveredFileOperations: cleanupRunSummary.deliveredOperations,
          executedFindings: cleanupRunSummary.executedFindings,
          eligibleFindings: cleanupRunSummary.eligibleFindings,
          detectedFindings: cleanupRunSummary.detectedFindings,
          blockerSummary:
            repositoryVerification.status === "verified"
              ? `${cleanupRunSummary.verifiedOperations} verified file operation(s) ready for cleanup PR.`
              : stored.payload.summary.blockerSummary,
        },
      };
      await storePatchKit(payload, stored.zipBuffer, stored.filename, stored.scanId);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sandbox execution failed";
    await failSandboxRun(runId, message.includes("SANDBOX_UNAVAILABLE") ? "SANDBOX_UNAVAILABLE" : "SANDBOX_EXECUTION_FAILED", message);
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
