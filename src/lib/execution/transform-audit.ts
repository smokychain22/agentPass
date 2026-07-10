import { createHash } from "node:crypto";

export type TransformEngineStatus =
  | "transform_noop"
  | "workspace_path_mismatch"
  | "stale_snapshot"
  | "write_failed"
  | "diff_generation_failed"
  | "source_hash_mismatch"
  | "verified_change";

export interface TransformAuditRecord {
  repositoryFullName?: string;
  branch?: string;
  commitSha?: string;
  projectRoot: string;
  findingId: string;
  findingPath: string;
  absoluteWorkspacePath: string;
  pluginId: string;
  strategyId: string;
  originalHash: string;
  transformedHash: string;
  persistedHash?: string;
  sourceChanged: boolean;
  changedFiles: string[];
  unifiedDiff: string;
  additions: number;
  deletions: number;
  engineStatus: TransformEngineStatus;
  blocker?: string;
}

export function hashSource(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

export function countDiffStats(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ")) continue;
    if (line.startsWith("+")) additions += 1;
    if (line.startsWith("-")) deletions += 1;
  }
  return { additions, deletions };
}

export function validateTransformInvariants(input: {
  originalSource: string;
  transformedSource: string;
  persistedSource?: string;
  unifiedDiff: string;
  changedFiles: string[];
  findingPath: string;
  workspacePathInsideRoot: boolean;
}): { ok: true; record: Pick<TransformAuditRecord, "originalHash" | "transformedHash" | "persistedHash" | "sourceChanged" | "additions" | "deletions" | "engineStatus"> } | { ok: false; engineStatus: TransformEngineStatus; blocker: string } {
  const originalHash = hashSource(input.originalSource);
  const transformedHash = hashSource(input.transformedSource);
  const persistedHash =
    input.persistedSource !== undefined ? hashSource(input.persistedSource) : undefined;
  const sourceChanged = originalHash !== transformedHash;

  if (!input.workspacePathInsideRoot) {
    return {
      ok: false,
      engineStatus: "workspace_path_mismatch",
      blocker: "Workspace path is outside the active isolated workspace.",
    };
  }

  if (!sourceChanged) {
    return {
      ok: false,
      engineStatus: "transform_noop",
      blocker: "Transformation produced identical source.",
    };
  }

  if (persistedHash !== undefined && persistedHash !== transformedHash) {
    return {
      ok: false,
      engineStatus: "source_hash_mismatch",
      blocker: "Persisted file hash does not match transformed source.",
    };
  }

  const { additions, deletions } = countDiffStats(input.unifiedDiff);
  if (!input.unifiedDiff.trim() || additions + deletions === 0) {
    return {
      ok: false,
      engineStatus: "diff_generation_failed",
      blocker: "Unified diff is empty.",
    };
  }

  if (!input.changedFiles.includes(input.findingPath)) {
    return {
      ok: false,
      engineStatus: "diff_generation_failed",
      blocker: "Changed files list does not include the target finding path.",
    };
  }

  return {
    ok: true,
    record: {
      originalHash,
      transformedHash,
      persistedHash,
      sourceChanged,
      additions,
      deletions,
      engineStatus: "verified_change",
    },
  };
}
