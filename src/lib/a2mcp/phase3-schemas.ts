import type { FindingsPayload } from "@/lib/findings/types";
import { ToolInputSchemas } from "@/lib/a2mcp/schemas";

export interface RepoRefInput {
  repoUrl?: string;
  branch?: string;
  scanId?: string;
  taskId?: string;
  commitSha?: string;
}

function readRepoRef(body: Record<string, unknown>): RepoRefInput {
  return {
    repoUrl: typeof body.repoUrl === "string" ? body.repoUrl.trim() : undefined,
    branch: typeof body.branch === "string" ? body.branch.trim() : undefined,
    scanId: typeof body.scanId === "string" ? body.scanId.trim() : undefined,
    taskId: typeof body.taskId === "string" ? body.taskId.trim() : undefined,
    commitSha: typeof body.commitSha === "string" ? body.commitSha.trim() : undefined,
  };
}

export const Phase3InputSchemas = {
  repoUrl(body: unknown): { repoUrl: string; branch?: string } {
    if (!body || typeof body !== "object") throw new Error("Invalid request body.");
    const record = body as Record<string, unknown>;
    if (typeof record.repoUrl !== "string" || !record.repoUrl.trim()) {
      throw new Error("repoUrl is required.");
    }
    return {
      repoUrl: record.repoUrl.trim(),
      branch: typeof record.branch === "string" ? record.branch.trim() : undefined,
    };
  },

  repoRef(body: unknown): RepoRefInput {
    if (!body || typeof body !== "object") throw new Error("Invalid request body.");
    const ref = readRepoRef(body as Record<string, unknown>);
    if (!ref.repoUrl && !ref.scanId && !ref.taskId) {
      throw new Error("repoUrl, scanId, or taskId is required.");
    }
    return ref;
  },

  scanId(body: unknown): { scanId: string } {
    if (!body || typeof body !== "object") throw new Error("Invalid request body.");
    const record = body as Record<string, unknown>;
    if (typeof record.scanId !== "string" || !record.scanId.trim()) {
      throw new Error("scanId is required.");
    }
    return { scanId: record.scanId.trim() };
  },

  runCleanup(body: unknown): {
    scanId?: string;
    repoUrl?: string;
    branch?: string;
    operation: "free_proof" | "quick_cleanup";
    findingIds?: string[];
    quoteId?: string;
  } {
    if (!body || typeof body !== "object") throw new Error("Invalid request body.");
    const record = body as Record<string, unknown>;
    const operation =
      record.operation === "quick_cleanup" ? "quick_cleanup" : "free_proof";
    return {
      ...readRepoRef(record),
      operation,
      findingIds: Array.isArray(record.findingIds)
        ? record.findingIds.filter((id): id is string => typeof id === "string")
        : undefined,
      quoteId: typeof record.quoteId === "string" ? record.quoteId.trim() : undefined,
    };
  },

  verifyCleanup(body: unknown): { patchId?: string; cleanupRunId?: string; scanId?: string } {
    if (!body || typeof body !== "object") throw new Error("Invalid request body.");
    const record = body as Record<string, unknown>;
    const patchId = typeof record.patchId === "string" ? record.patchId.trim() : undefined;
    const cleanupRunId =
      typeof record.cleanupRunId === "string" ? record.cleanupRunId.trim() : undefined;
    const scanId = typeof record.scanId === "string" ? record.scanId.trim() : undefined;
    if (!patchId && !cleanupRunId) {
      throw new Error("patchId or cleanupRunId is required.");
    }
    return { patchId, cleanupRunId, scanId };
  },

  configurePolicy(body: unknown): {
    repoUrl: string;
    branch?: string;
    protectedPaths?: string[];
    protectedGlobs?: string[];
  } {
    const base = Phase3InputSchemas.repoUrl(body);
    const record = body as Record<string, unknown>;
    return {
      ...base,
      protectedPaths: Array.isArray(record.protectedPaths)
        ? record.protectedPaths.filter((p): p is string => typeof p === "string")
        : undefined,
      protectedGlobs: Array.isArray(record.protectedGlobs)
        ? record.protectedGlobs.filter((p): p is string => typeof p === "string")
        : undefined,
    };
  },

  createCleanupPr(body: unknown) {
    return ToolInputSchemas.createCleanupPr(body);
  },
};

export async function resolveFindingsPayload(
  ref: RepoRefInput,
  getTask?: (taskId: string) => Promise<{ scanId?: string } | undefined>
): Promise<FindingsPayload> {
  const { getStoredFindings } = await import("@/lib/findings/findings-store");
  const { scanRepository } = await import("@/lib/execution");

  if (ref.scanId) {
    const findings = await getStoredFindings(ref.scanId);
    if (!findings) throw new Error(`Findings not found for scanId ${ref.scanId}.`);
    return findings;
  }

  if (ref.taskId && getTask) {
    const task = await getTask(ref.taskId);
    if (task?.scanId) {
      const findings = await getStoredFindings(task.scanId);
      if (findings) return findings;
    }
  }

  if (ref.repoUrl) {
    return scanRepository(ref.repoUrl, ref.branch);
  }

  throw new Error("Unable to resolve findings — provide scanId, taskId, or repoUrl.");
}
