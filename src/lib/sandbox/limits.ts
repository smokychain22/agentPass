/**
 * Resource limits for untrusted customer repository execution.
 * Trusted delivery (GitHub App / signing) must never run under these constraints alone.
 */

export const SANDBOX_LIMITS = {
  maxCpuSeconds: 600,
  maxMemoryMb: 2048,
  maxDiskMb: 4096,
  maxProcessCount: 64,
  maxOutputBytes: 8 * 1024 * 1024,
  maxWallClockMs: 15 * 60 * 1000,
  allowDockerSocket: false,
  allowHostFilesystem: false,
  allowCloudMetadata: false,
  allowInternalNetwork: false,
} as const;

export interface SandboxWorkspaceSpec {
  tenantId: string;
  taskId: string;
  workspaceRoot: string;
  readOnlyRoot: boolean;
  writablePaths: string[];
}

export function buildSandboxWorkspaceSpec(input: {
  tenantId: string;
  taskId: string;
  workspaceRoot: string;
}): SandboxWorkspaceSpec {
  return {
    tenantId: input.tenantId,
    taskId: input.taskId,
    workspaceRoot: input.workspaceRoot,
    readOnlyRoot: true,
    writablePaths: [input.workspaceRoot, "/tmp", process.env.TMPDIR || "/tmp"],
  };
}
