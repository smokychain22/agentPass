/**
 * Build Phase 1 universal coverage from the pinned Git commit + worktree.
 * ZIP/worktree is for materialization only — membership comes from the git tree.
 */
import { access } from "node:fs/promises";
import path from "node:path";
import { loadPinnedCommitTree, fetchPinnedCommitTreeViaApi } from "./git-tree-inventory";
import { reconcileGitTreeWithWorktree } from "./worktree-reconcile";
import { applyFallbackChainToInventory } from "./fallback-chain";
import { buildUniversalCoverageReport } from "./build-coverage-report";
import type { UniversalCoverageReport } from "./types";

export interface RunUniversalCoverageInput {
  owner: string;
  repository: string;
  pinnedCommitSha: string;
  worktreeRoot: string;
  /** Optional GitHub token for Trees API when .git is absent. */
  githubToken?: string;
  repositoryId?: string;
  /** True when Knip/Madge/jscpd (or their fallbacks) produced usable JS/TS coverage. */
  jsTsSemanticSucceeded?: boolean;
}

export async function runUniversalCoverage(
  input: RunUniversalCoverageInput
): Promise<UniversalCoverageReport> {
  if (!/^[0-9a-f]{7,40}$/i.test(input.pinnedCommitSha)) {
    throw new Error(`invalid_pinned_commit:${input.pinnedCommitSha}`);
  }

  let treeSha: string;
  let entries: Awaited<ReturnType<typeof loadPinnedCommitTree>>["entries"];

  const gitDir = path.join(input.worktreeRoot, ".git");
  let hasGit = false;
  try {
    await access(gitDir);
    hasGit = true;
  } catch {
    hasGit = false;
  }

  if (hasGit) {
    const loaded = await loadPinnedCommitTree({
      owner: input.owner,
      repo: input.repository,
      commitSha: input.pinnedCommitSha,
      repoDir: input.worktreeRoot,
      token: input.githubToken,
    });
    treeSha = loaded.treeSha;
    entries = loaded.entries;
  } else {
    const loaded = await fetchPinnedCommitTreeViaApi(
      input.owner,
      input.repository,
      input.pinnedCommitSha,
      { token: input.githubToken }
    );
    treeSha = loaded.treeSha;
    entries = loaded.entries;
  }

  const reconciled = await reconcileGitTreeWithWorktree({
    entries,
    worktreeRoot: input.worktreeRoot,
    owner: input.owner,
    repository: input.repository,
    pinnedCommitSha: input.pinnedCommitSha,
    treeSha,
    repositoryId: input.repositoryId,
  });

  const chained = applyFallbackChainToInventory(reconciled.inventory, {
    jsTsSemanticSucceeded: input.jsTsSemanticSucceeded,
    owner: input.owner,
    repository: input.repository,
    pinnedCommitSha: input.pinnedCommitSha,
  });

  return buildUniversalCoverageReport({
    inventory: chained.inventory,
    attempts: chained.attempts,
    nonAuthoritativeWorktreeArtifacts: reconciled.nonAuthoritativeArtifacts,
    materializationMismatchCount: reconciled.materializationMismatchCount,
  });
}

/** Legacy marker for scans without Phase 1 inventory — never synthesizes 100% accounting. */
export function legacyCoverageReport(): UniversalCoverageReport {
  return {
    coverageVersion: "legacy",
    trackedGitPaths: 0,
    accountedForPaths: 0,
    semanticPathCount: 0,
    structuralPathCount: 0,
    textualPathCount: 0,
    metadataPathCount: 0,
    binaryPathCount: 0,
    generatedPathCount: 0,
    vendoredPathCount: 0,
    protectedPathCount: 0,
    unreadablePathCount: 0,
    analyzerFailurePathCount: 0,
    materializationMismatchCount: 0,
    accountingCoveragePercent: 0,
    semanticCoveragePercent: 0,
    structuralCoveragePercent: 0,
    fallbackCoveragePercent: 0,
    claimsSemanticAnalysisOfAllFiles: false,
    inventory: [],
    attempts: [],
    topology: {
      manifests: [],
      projectRoots: [],
      packageManagers: [],
      frameworks: [],
      submodulePaths: [],
      lfsPointerPaths: [],
    },
    nonAuthoritativeWorktreeArtifacts: [],
    analyzerFailures: [],
    unreadablePaths: [],
    materializationMismatches: [],
  };
}
