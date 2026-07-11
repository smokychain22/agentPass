import { start } from "workflow/api";
import { readInstallationSession } from "@/lib/github-app/session";
import {
  createSandboxRun,
  getSandboxRunByCleanupRunId,
  updateSandboxRun,
} from "@/lib/execution/sandbox-run-store";
import type { SandboxRunPayload } from "@/lib/execution/sandbox-run-types";
import { repositoryCleanupWorkflow } from "@/app/workflows/repository-cleanup-workflow";
import { isVercelSandboxAvailable } from "@/lib/execution/vercel-sandbox";
import { isServerlessRuntime } from "@/lib/server/runtime-env";
import { executeRepositoryCleanup } from "@/lib/execution/repository-executor";
import { completeSandboxRun, failSandboxRun } from "@/lib/execution/sandbox-run-store";
import { getStoredPatchKit, storePatchKit } from "@/lib/patch-kit/patch-kit-store";
import { buildCleanupRunSummary } from "@/lib/patch-kit/cleanup-summary";

export class SandboxUnavailableError extends Error {
  code = "SANDBOX_UNAVAILABLE" as const;
  constructor() {
    super("Vercel Sandbox is not available in this deployment.");
  }
}

async function persistWorkflowResults(runId: string, cleanupRunId: string): Promise<void> {
  const stored = await getStoredPatchKit(cleanupRunId);
  const run = await getSandboxRunByCleanupRunId(cleanupRunId);
  if (!stored?.payload || !run?.result) return;

  const repositoryVerification = run.result.repositoryVerification!;
  const patchValidation = run.result.patchValidation!;
  const cleanupRunSummary = buildCleanupRunSummary({
    findings: stored.payload.artifacts.findingsJson!,
    summary: stored.payload.summary,
    candidateAudits: stored.payload.candidateAudits,
    changeOperations: stored.payload.changeOperations,
    verification: repositoryVerification,
  });

  await storePatchKit(
    {
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
    },
    stored.zipBuffer,
    stored.filename,
    stored.scanId
  );
}

export async function startRepositoryCleanupExecution(
  payload: SandboxRunPayload
): Promise<{ sandboxRunId: string; workflowRunId?: string }> {
  const session = await readInstallationSession();
  const enriched: SandboxRunPayload = {
    ...payload,
    installationId: session?.installationId,
  };

  const run = await createSandboxRun(enriched);

  if (isVercelSandboxAvailable()) {
    const workflowRun = await start(repositoryCleanupWorkflow, [run.id, enriched]);
    await updateSandboxRun(run.id, {
      workflowRunId: workflowRun.runId,
      status: "starting",
      progress: "Workflow started",
    });
    return { sandboxRunId: run.id, workflowRunId: workflowRun.runId };
  }

  if (!isServerlessRuntime()) {
    void (async () => {
      try {
        const result = await executeRepositoryCleanup(run.id, enriched);
        await completeSandboxRun(
          run.id,
          {
            patchValidation: result.patchValidation,
            repositoryVerification: result.repositoryVerification,
            gitVersion: result.gitVersion,
            patchHash: result.patchHash,
            logs: result.logs,
          },
          result.repositoryVerification.status === "verified" ? "ready_for_delivery" : "blocked"
        );
        await persistWorkflowResults(run.id, payload.cleanupRunId);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Execution failed";
        await failSandboxRun(run.id, "LOCAL_EXECUTION_FAILED", message);
      }
    })();
    return { sandboxRunId: run.id };
  }

  throw new SandboxUnavailableError();
}
