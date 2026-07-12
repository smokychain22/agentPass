import {
  createSandboxRun,
  getSandboxRunByCleanupRunId,
} from "@/lib/execution/sandbox-run-store";
import type { SandboxRunPayload } from "@/lib/execution/sandbox-run-types";
import { isVercelSandboxAvailable } from "@/lib/execution/vercel-sandbox";
import { isServerlessRuntime } from "@/lib/server/runtime-env";
import { readInstallationSession } from "@/lib/github-app/session";
import { dispatchSandboxExecution } from "@/lib/execution/dispatch-sandbox-execution";
import {
  isTerminalSandboxStatus,
  reconcileSandboxRun,
} from "@/lib/execution/reconcile-sandbox-run";

export class SandboxUnavailableError extends Error {
  code = "SANDBOX_UNAVAILABLE" as const;
  constructor(message = "Vercel Sandbox is not available in this deployment.") {
    super(message);
  }
}

export { isTerminalSandboxStatus, reconcileSandboxRun };

export async function kickSandboxExecution(
  runId: string,
  payload: SandboxRunPayload
): Promise<void> {
  await dispatchSandboxExecution(runId, payload);
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
    await dispatchSandboxExecution(existing.id, existing.payload);
    return { sandboxRunId: existing.id, workflowRunId: existing.workflowRunId };
  }

  const run = await createSandboxRun(enriched);

  if (isVercelSandboxAvailable() || !isServerlessRuntime()) {
    await dispatchSandboxExecution(run.id, enriched);
    return { sandboxRunId: run.id };
  }

  throw new SandboxUnavailableError();
}
