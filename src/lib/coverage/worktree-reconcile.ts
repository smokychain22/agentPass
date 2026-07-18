import fs from "node:fs/promises";
import path from "node:path";
import type { GitTreeEntry } from "./git-tree-inventory";
import {
  classifyTrackedPath,
  detectGitlinkMode,
  detectLfsPointerContent,
  detectSymlinkMode,
} from "./classify-path";
import { assertSafeRepoRelativePath, normalizeRepoRelativePath } from "./path-normalize";
import type {
  CoverageInventoryEntry,
  MaterializationStatus,
} from "./types";

const IGNORE_DIR_NAMES = new Set(["node_modules", ".git"]);

function resolveUnderWorktree(worktreeRoot: string, relPath: string): string {
  assertSafeRepoRelativePath(relPath);
  const rootResolved = path.resolve(worktreeRoot);
  const full = path.resolve(rootResolved, relPath);
  const rootWithSep = rootResolved.endsWith(path.sep)
    ? rootResolved
    : rootResolved + path.sep;
  if (full !== rootResolved && !full.startsWith(rootWithSep)) {
    throw new Error(`path_escapes_worktree:${relPath}`);
  }
  return full;
}

function isExecutableMode(mode: string): boolean {
  return mode === "100755" || mode === "0100755";
}

async function readLfsPointerPreview(absPath: string): Promise<string | undefined> {
  try {
    const handle = await fs.open(absPath, "r");
    try {
      const buf = Buffer.alloc(256);
      const { bytesRead } = await handle.read(buf, 0, 256, 0);
      if (bytesRead <= 0) return undefined;
      return buf.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
}

async function materializeEntry(
  entry: GitTreeEntry,
  absPath: string
): Promise<{
  status: MaterializationStatus;
  reason?: string;
  contentText?: string;
  contentInspected: boolean;
}> {
  const symlink = detectSymlinkMode(entry.mode);
  const submodule = detectGitlinkMode(entry.mode) || entry.type === "commit";

  let st: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    st = await fs.lstat(absPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return {
        status: "NOT_MATERIALIZED",
        reason: "Path present in pinned git tree but missing from worktree.",
        contentInspected: false,
      };
    }
    return {
      status: "MATERIALIZATION_FAILED_WITH_REASON",
      reason: `lstat_failed:${code ?? "unknown"}`,
      contentInspected: false,
    };
  }

  if (submodule) {
    return {
      status: "SUBMODULE_GITLINK",
      reason: "Gitlink/submodule entry — not expanded in Phase 1.",
      contentInspected: false,
    };
  }

  if (symlink || st.isSymbolicLink()) {
    return {
      status: "SYMLINK_REPRESENTED",
      reason: "Symlink represented without following target.",
      contentInspected: false,
    };
  }

  if (st.isDirectory()) {
    return {
      status: "MATERIALIZATION_FAILED_WITH_REASON",
      reason: "Expected blob path but found directory in worktree.",
      contentInspected: false,
    };
  }

  const contentText = await readLfsPointerPreview(absPath);
  if (contentText && detectLfsPointerContent(contentText)) {
    return {
      status: "LFS_POINTER",
      reason: "Git LFS pointer file materialized (pointer only).",
      contentText,
      contentInspected: true,
    };
  }

  return {
    status: "MATERIALIZED",
    contentText,
    contentInspected: Boolean(contentText),
  };
}

async function walkWorktreeFiles(
  root: string,
  relative: string,
  out: string[]
): Promise<void> {
  const abs = relative ? resolveUnderWorktree(root, relative) : path.resolve(root);
  let dirents;
  try {
    dirents = await fs.readdir(abs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const dirent of dirents) {
    if (IGNORE_DIR_NAMES.has(dirent.name)) continue;
    const childRel = relative ? `${relative}/${dirent.name}` : dirent.name;
    let normalized: string;
    try {
      normalized = normalizeRepoRelativePath(childRel);
    } catch {
      continue;
    }
    if (dirent.isDirectory() && !dirent.isSymbolicLink()) {
      await walkWorktreeFiles(root, normalized, out);
      continue;
    }
    // Files, symlinks, and other non-dir entries are worktree artifacts.
    out.push(normalized);
  }
}

export interface ReconcileGitTreeInput {
  entries: GitTreeEntry[];
  worktreeRoot: string;
  owner: string;
  repository: string;
  pinnedCommitSha: string;
  treeSha?: string;
  repositoryId?: string;
}

export interface ReconcileGitTreeResult {
  inventory: CoverageInventoryEntry[];
  nonAuthoritativeArtifacts: Array<{ path: string; reason: string }>;
  materializationMismatchCount: number;
}

/**
 * Reconcile every pinned git blob/gitlink path with the local worktree.
 * Enumerates all tracked paths (including generated/vendor) — no silent skips.
 */
export async function reconcileGitTreeWithWorktree(
  input: ReconcileGitTreeInput
): Promise<ReconcileGitTreeResult> {
  const inventory: CoverageInventoryEntry[] = [];
  const tracked = new Set<string>();
  let materializationMismatchCount = 0;

  for (const entry of input.entries) {
    if (entry.type === "tree") continue;

    const pathExact = normalizeRepoRelativePath(entry.path);
    tracked.add(pathExact);

    const absPath = resolveUnderWorktree(input.worktreeRoot, pathExact);
    const materialization = await materializeEntry(entry, absPath);

    if (
      materialization.status === "NOT_MATERIALIZED" ||
      materialization.status === "MATERIALIZATION_FAILED_WITH_REASON"
    ) {
      materializationMismatchCount += 1;
    }

    const classified = classifyTrackedPath({
      path: pathExact,
      mode: entry.mode,
      objectType: entry.type,
      byteSize: entry.size,
      contentText: materialization.contentText,
    });

    const outcome =
      materialization.status === "NOT_MATERIALIZED" ||
      materialization.status === "MATERIALIZATION_FAILED_WITH_REASON"
        ? ("UNREADABLE_WITH_REASON" as const)
        : classified.outcome;

    const classificationReason =
      materialization.status === "NOT_MATERIALIZED" ||
      materialization.status === "MATERIALIZATION_FAILED_WITH_REASON"
        ? materialization.reason
        : classified.reason;

    const matchingRule =
      materialization.status === "NOT_MATERIALIZED" ||
      materialization.status === "MATERIALIZATION_FAILED_WITH_REASON"
        ? "materialization_mismatch"
        : classified.matchingRule;

    inventory.push({
      pathExact,
      pathNormalized: pathExact,
      objectType: entry.type,
      objectSha: entry.sha,
      mode: entry.mode,
      executable: isExecutableMode(entry.mode),
      symlink: classified.symlink,
      submodule: classified.submodule,
      byteSize: entry.size ?? 0,
      materializationStatus: materialization.status,
      materializationReason: materialization.reason,
      analyzerPlan: classified.analyzerPlan,
      finalCoverageOutcome: outcome,
      classificationReason,
      matchingRule,
      contentInspected: materialization.contentInspected,
      modificationBlockedByPolicy: classified.protected,
      ...(input.repositoryId ? { repositoryId: input.repositoryId } : {}),
      owner: input.owner,
      repository: input.repository,
      pinnedCommitSha: input.pinnedCommitSha,
      ...(input.treeSha ? { treeSha: input.treeSha } : {}),
    });
  }

  const worktreeFiles: string[] = [];
  await walkWorktreeFiles(input.worktreeRoot, "", worktreeFiles);

  const nonAuthoritativeArtifacts: Array<{ path: string; reason: string }> = [];
  for (const worktreePath of worktreeFiles) {
    if (tracked.has(worktreePath)) continue;
    nonAuthoritativeArtifacts.push({
      path: worktreePath,
      reason: "Present in worktree but not in pinned commit git tree.",
    });
  }

  return {
    inventory,
    nonAuthoritativeArtifacts,
    materializationMismatchCount,
  };
}
