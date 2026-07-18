import { assertCoverageInvariants } from "./invariants";
import { buildCoverageMetrics } from "./metrics";
import { discoverRepositoryTopology } from "./topology";
import type {
  AnalyzerAttempt,
  CoverageInventoryEntry,
  RepositoryTopologyDiscovery,
  UniversalCoverageReport,
} from "./types";

export interface BuildUniversalCoverageReportArgs {
  inventory: CoverageInventoryEntry[];
  attempts?: AnalyzerAttempt[];
  topology?: RepositoryTopologyDiscovery;
  nonAuthoritativeWorktreeArtifacts?: Array<{ path: string; reason: string }>;
  /** Override mismatch count; defaults to metrics derivation from inventory. */
  materializationMismatchCount?: number;
}

/**
 * Assemble a Phase 1 universal coverage report from inventory + topology + attempts.
 * Always runs assertCoverageInvariants before returning.
 */
export function buildUniversalCoverageReport(
  args: BuildUniversalCoverageReportArgs
): UniversalCoverageReport {
  const inventory = args.inventory;
  const attempts = args.attempts ?? [];
  const metrics = buildCoverageMetrics(inventory);

  const baseTopology =
    args.topology ??
    discoverRepositoryTopology(inventory.map((entry) => entry.pathExact));

  const submodulePaths =
    baseTopology.submodulePaths.length > 0
      ? baseTopology.submodulePaths
      : inventory.filter((e) => e.submodule).map((e) => e.pathExact);

  const lfsPointerPaths =
    baseTopology.lfsPointerPaths.length > 0
      ? baseTopology.lfsPointerPaths
      : inventory
          .filter((e) => e.materializationStatus === "LFS_POINTER")
          .map((e) => e.pathExact);

  const topology: RepositoryTopologyDiscovery = {
    ...baseTopology,
    submodulePaths,
    lfsPointerPaths,
  };

  const claimsSemanticAnalysisOfAllFiles =
    inventory.length > 0 &&
    inventory.every((entry) => entry.finalCoverageOutcome === "SEMANTICALLY_ANALYZED");

  const report: UniversalCoverageReport = {
    coverageVersion: "phase1",
    trackedGitPaths: metrics.trackedGitPaths,
    accountedForPaths: metrics.accountedForPaths,
    semanticPathCount: metrics.semanticPathCount,
    structuralPathCount: metrics.structuralPathCount,
    textualPathCount: metrics.textualPathCount,
    metadataPathCount: metrics.metadataPathCount,
    binaryPathCount: metrics.binaryPathCount,
    generatedPathCount: metrics.generatedPathCount,
    vendoredPathCount: metrics.vendoredPathCount,
    protectedPathCount: metrics.protectedPathCount,
    unreadablePathCount: metrics.unreadablePathCount,
    analyzerFailurePathCount: metrics.analyzerFailurePathCount,
    materializationMismatchCount:
      args.materializationMismatchCount ?? metrics.materializationMismatchCount,
    accountingCoveragePercent: metrics.accountingCoveragePercent,
    semanticCoveragePercent: metrics.semanticCoveragePercent,
    structuralCoveragePercent: metrics.structuralCoveragePercent,
    fallbackCoveragePercent: metrics.fallbackCoveragePercent,
    claimsSemanticAnalysisOfAllFiles,
    inventory,
    attempts,
    topology,
    nonAuthoritativeWorktreeArtifacts: args.nonAuthoritativeWorktreeArtifacts ?? [],
    analyzerFailures: metrics.analyzerFailures,
    unreadablePaths: metrics.unreadablePaths,
    materializationMismatches: metrics.materializationMismatches,
  };

  assertCoverageInvariants(report);
  return report;
}
