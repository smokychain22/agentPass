import { after } from "next/server";
import { getAppBaseUrl } from "@/lib/github-app/app-base-url";
import { isServerlessRuntime } from "@/lib/server/runtime-env";
import {
  getSandboxRun,
  isTerminalSandboxStatus,
  updateSandboxRun,
} from "@/lib/execution/sandbox-run-store";
import type { SandboxRun, SandboxRunPayload } from "@/lib/execution/sandbox-run-types";
import { isActiveSandboxStatus, isStaleActiveSandboxRun, runSandboxExecutionOnce } from "@/lib/execution/execute-sandbox-run";
import { workerApiKeyConfigured } from "@/lib/worker/worker-auth";

const REDISPATCH_MS = 30_000;

function nowIso(): string {
  return new Date().toISOString();
}

export function shouldDispatchSandboxExecution(run: SandboxRun): boolean {
  if (isTerminalSandboxStatus(run.status)) return false;
  if (isActiveSandboxStatus(run.status) && !isStaleActiveSandboxRun(run)) return false;

  const lastDispatch = run.executionDispatchedAt
    ? new Date(run.executionDispatchedAt).getTime()
    : 0;
  const sinceDispatch = Date.now() - lastDispatch;

  if (["queued", "starting", "resolving_repository"].includes(run.status)) {
    return sinceDispatch >= REDISPATCH_MS;
  }

  const ageMs = Date.now() - new Date(run.updatedAt).getTime();
  return ageMs >= REDISPATCH_MS;
}

export async function dispatchSandboxExecution(
  runId: string,
  payload?: SandboxRunPayload
): Promise<void> {
  const run = await getSandboxRun(runId);
  if (!run) return;
  if (!shouldDispatchSandboxExecution(run)) return;

  await updateSandboxRun(runId, {
    status: run.status === "queued" ? "starting" : run.status,
    progress: "Dispatching isolated sandbox worker",
    executionDispatchedAt: nowIso(),
    payload: payload ?? run.payload,
  });

  if (isServerlessRuntime() && workerApiKeyConfigured()) {
    const url = `${getAppBaseUrl()}/api/internal/sandbox-runs/execute`;
    void fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WORKER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ runId }),
    }).catch((err) => {
      console.error("[repodiet-sandbox-dispatch] failed to dispatch execute route", err);
    });
    return;
  }

  const runInline = () => {
    void runSandboxExecutionOnce(runId).catch((err) => {
      console.error("[repodiet-sandbox-dispatch] inline execution failed", err);
    });
  };

  if (isServerlessRuntime()) {
    after(runInline);
    return;
  }

  runInline();
}
