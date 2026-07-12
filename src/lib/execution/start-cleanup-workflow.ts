import { after } from "next/server";
import { start } from "workflow/api";
import { readInstallationSession } from "@/lib/github-app/session";
import {
  completeSandboxRun,
  createSandboxRun,
  failSandboxRun,
  getSandboxRunByCleanupRunId,
  updateSandboxRun,
} from "@/lib/execution/sandbox-run-store";
import type { SandboxRunPayload } from "@/lib/execution/sandbox-run-types";
import { repositoryCleanupWorkflow } from "@/app/workflows/repository-cleanup-workflow";
import { isVercelSandboxAvailable } from "@/lib/execution/vercel-sandbox";
import { isServerlessRuntime } from "@/lib/server/runtime-env";
import { executeRepositoryCleanup } from "@/lib/execution/repository-executor";
import { getStoredPatchKit, storePatchKit } from "@/lib/patch-kit/patch-kit-store";
import { buildCleanupRunSummary } from "@/lib/patch-kit/cleanup-summary";

export class SandboxUnavailableError extends Error {
  code = "SANDBOX_UNAVAILABLE" as const;
  constructor(message = "Vercel Sandbox is not available in this deployment.") {
    super(message);
  }
}

async function persistWorkflowResults(cleanupRunId: string): Promise<void> {
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
      sandboxRunId: run.id,
      workflowRunId: run.workflowRunId,
      cleanupRunSummary,
      summary: {
        ...stored.payload.summary,
        patchValidationStatus: patchValidation.status,
        detectedFindings: cleanupRunSummary.detectedFindings,
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

function scheduleBackgroundExecution(runId: string, payload: SandboxRunPayload): void {
  const task = async () => {
    try {
      const result = await executeRepositoryCleanup(runId, payload);
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
      await persistWorkflowResults(payload.cleanupRunId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sandbox execution failed";
      await failSandboxRun(
        runId,
        message.includes("SANDBOX") ? "SANDBOX_UNAVAILABLE" : "SANDBOX_EXECUTION_FAILED",
        message
      );
    }
  };

  if (isServerlessRuntime()) {
    after(task);
  } else {
    void task();
  }
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
    try {
      const workflowRun = await start(repositoryCleanupWorkflow, [run.id, enriched]);
      await updateSandboxRun(run.id, {
        workflowRunId: workflowRun.runId,
        status: "starting",
        progress: "Workflow started",
      });
      return { sandboxRunId: run.id, workflowRunId: workflowRun.runId };
    } catch (err) {
      await updateSandboxRun(run.id, {
        status: "starting",
        progress: "Workflow unavailable — running sandbox execution directly",
      });
      scheduleBackgroundExecution(run.id, enriched);
      return { sandboxRunId: run.id };
    }
  }

  if (!isServerlessRuntime()) {
    scheduleBackgroundExecution(run.id, enriched);
    return { sandboxRunId: run.id };
  }

  throw new SandboxUnavailableError();
}
