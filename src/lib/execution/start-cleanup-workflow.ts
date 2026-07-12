import { after } from "next/server";
import {
  completeSandboxRun,
  createSandboxRun,
  failSandboxRun,
  getSandboxRun,
  getSandboxRunByCleanupRunId,
  updateSandboxRun,
} from "@/lib/execution/sandbox-run-store";
import type { SandboxRun, SandboxRunPayload } from "@/lib/execution/sandbox-run-types";
import { isVercelSandboxAvailable } from "@/lib/execution/vercel-sandbox";
import { isServerlessRuntime } from "@/lib/server/runtime-env";
import { executeRepositoryCleanup } from "@/lib/execution/repository-executor";
import { persistSandboxResultsToPatchKit } from "@/lib/execution/persist-sandbox-results";
import { readInstallationSession } from "@/lib/github-app/session";

export class SandboxUnavailableError extends Error {
  code = "SANDBOX_UNAVAILABLE" as const;
  constructor(message = "Vercel Sandbox is not available in this deployment.") {
    super(message);
  }
}

const TERMINAL_STATUSES = new Set([
  "delivered",
  "failed",
  "blocked",
  "timed_out",
  "ready_for_delivery",
]);

const STALE_KICK_MS = 90_000;

export function isTerminalSandboxStatus(status: SandboxRun["status"]): boolean {
  return TERMINAL_STATUSES.has(status);
}

function scheduleBackgroundExecution(runId: string, payload: SandboxRunPayload): void {
  const task = async () => {
    try {
      const result = await executeRepositoryCleanup(runId, payload);
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
        cleanupRunId: payload.cleanupRunId,
        patchValidation: result.patchValidation,
        repositoryVerification: result.repositoryVerification,
        sandboxRunId: runId,
      });
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

export async function kickSandboxExecution(
  runId: string,
  payload: SandboxRunPayload
): Promise<void> {
  scheduleBackgroundExecution(runId, payload);
  await updateSandboxRun(runId, {
    status: "starting",
    progress: "Sandbox execution queued",
    progressDetail: "execution_kicked",
  });
}

function isStaleSandboxRun(run: SandboxRun): boolean {
  if (isTerminalSandboxStatus(run.status)) return false;
  const ageMs = Date.now() - new Date(run.updatedAt).getTime();
  if (ageMs < STALE_KICK_MS) return false;
  return ["queued", "starting", "resolving_repository"].includes(run.status);
}

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

  if (isStaleSandboxRun(run)) {
    await kickSandboxExecution(run.id, run.payload);
    const refreshed = await getSandboxRun(run.id);
    return refreshed ?? run;
  }

  return run;
}

export async function startRepositoryCleanupExecution(
  payload: SandboxRunPayload
): Promise<{ sandboxRunId: string; workflowRunId?: string }> {
  const session = await readInstallationSession();
  const enriched: SandboxRunPayload = {
    ...payload,
    installationId: payload.installationId ?? session?.installationId,
  };

  const existing = await getSandboxRunByCleanupRunId(payload.cleanupRunId);
  if (existing && !isTerminalSandboxStatus(existing.status)) {
    if (isStaleSandboxRun(existing)) {
      await kickSandboxExecution(existing.id, existing.payload);
    }
    return { sandboxRunId: existing.id, workflowRunId: existing.workflowRunId };
  }

  const run = await createSandboxRun(enriched);

  if (isVercelSandboxAvailable() || !isServerlessRuntime()) {
    await kickSandboxExecution(run.id, enriched);
    return { sandboxRunId: run.id };
  }

  throw new SandboxUnavailableError();
}
