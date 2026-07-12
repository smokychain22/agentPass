import { Sandbox } from "@vercel/sandbox";
import { SANDBOX_TIMEOUT_MS } from "./sandbox-run-types";

export function isVercelSandboxAvailable(): boolean {
  return Boolean(process.env.VERCEL);
}

export interface CreateCleanupSandboxInput {
  cleanupRunId: string;
  repositoryId: string;
  baseCommitSha: string;
}

export async function createCleanupSandbox(
  input: CreateCleanupSandboxInput
): Promise<Sandbox> {
  const safeName = `repodiet-${input.cleanupRunId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 40)}`;

  const sandbox = await Sandbox.create({
    name: safeName,
    runtime: "node22",
    timeout: SANDBOX_TIMEOUT_MS,
    persistent: false,
    resources: { vcpus: 2 },
    tags: {
      cleanupRunId: input.cleanupRunId,
      repositoryId: input.repositoryId,
      baseCommitSha: input.baseCommitSha.slice(0, 12),
      executionType: "repodiet-verification",
    },
  });

  return sandbox;
}

export async function stopCleanupSandbox(sandbox: Sandbox | undefined): Promise<void> {
  if (!sandbox) return;
  try {
    await sandbox.stop();
  } catch {
    /* best effort */
  }
}

export function sandboxWorkspaceRoot(cleanupRunId: string): string {
  const safe = cleanupRunId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `/vercel/sandbox/repodiet/${safe}`;
}
