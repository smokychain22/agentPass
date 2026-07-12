import type { Sandbox } from "@vercel/sandbox";
import { Sandbox as SandboxSdk } from "@vercel/sandbox";
import { SANDBOX_TIMEOUT_MS } from "./sandbox-run-types";

function optionalSandboxCredentials():
  | { token: string; teamId: string; projectId: string }
  | undefined {
  const token =
    process.env.VERCEL_TOKEN?.trim() ||
    process.env.VERCEL_OIDC_TOKEN?.trim() ||
    undefined;
  const teamId = process.env.VERCEL_TEAM_ID?.trim();
  const projectId = process.env.VERCEL_PROJECT_ID?.trim();
  if (token && teamId && projectId) {
    return { token, teamId, projectId };
  }
  return undefined;
}

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
  const credentials = optionalSandboxCredentials();

  const sandbox = await SandboxSdk.create({
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
    ...(credentials ?? {}),
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
