import type { TerminalCoverageOutcome } from "./outcomes";
import type {
  CoverageInventoryEntry,
  CoverageMetricsFromInventory,
  MaterializationStatus,
} from "./types";

function percent(numerator: number, denominator: number): number {
  // Empty repository: vacuous 100% accounting when inventory successfully recorded zero paths.
  if (denominator <= 0) return numerator <= 0 ? 100 : 0;
  return (numerator / denominator) * 100;
}

function countOutcome(
  inventory: CoverageInventoryEntry[],
  outcome: TerminalCoverageOutcome
): number {
  return inventory.filter((entry) => entry.finalCoverageOutcome === outcome).length;
}

function isMaterializationMismatch(status: MaterializationStatus): boolean {
  return (
    status === "MATERIALIZATION_FAILED_WITH_REASON" || status === "NOT_MATERIALIZED"
  );
}

/**
 * Derive Phase 1 coverage counts and percents from a completed inventory.
 * trackedGitPaths / accountedForPaths are both inventory.length (full accounting).
 */
export function buildCoverageMetrics(
  inventory: CoverageInventoryEntry[]
): CoverageMetricsFromInventory {
  const trackedGitPaths = inventory.length;
  const accountedForPaths = inventory.length;

  const semanticPathCount = countOutcome(inventory, "SEMANTICALLY_ANALYZED");
  const structuralPathCount = countOutcome(inventory, "STRUCTURALLY_ANALYZED");
  const textualPathCount = countOutcome(inventory, "TEXTUALLY_ANALYZED");
  const metadataPathCount = countOutcome(inventory, "METADATA_ANALYZED");
  const binaryPathCount = countOutcome(inventory, "BINARY_INSPECTED");
  const generatedPathCount = countOutcome(inventory, "GENERATED_CLASSIFIED");
  const vendoredPathCount = countOutcome(inventory, "VENDORED_CLASSIFIED");
  const protectedPathCount = countOutcome(inventory, "PROTECTED_BY_POLICY");
  const unreadablePathCount = countOutcome(inventory, "UNREADABLE_WITH_REASON");
  const analyzerFailurePathCount = countOutcome(inventory, "ANALYZER_FAILED_WITH_REASON");

  const fallbackPathCount =
    textualPathCount +
    metadataPathCount +
    binaryPathCount +
    generatedPathCount +
    vendoredPathCount +
    protectedPathCount +
    unreadablePathCount +
    analyzerFailurePathCount;

  const materializationMismatches = inventory
    .filter((entry) => isMaterializationMismatch(entry.materializationStatus))
    .map((entry) => entry.pathExact);

  const unreadablePaths = inventory
    .filter((entry) => entry.finalCoverageOutcome === "UNREADABLE_WITH_REASON")
    .map((entry) => entry.pathExact);

  const analyzerFailures = inventory
    .filter((entry) => entry.finalCoverageOutcome === "ANALYZER_FAILED_WITH_REASON")
    .map((entry) => entry.pathExact);

  const claimsSemanticAnalysisOfAllFiles =
    trackedGitPaths > 0 &&
    inventory.every((entry) => entry.finalCoverageOutcome === "SEMANTICALLY_ANALYZED");

  return {
    coverageVersion: "phase1",
    trackedGitPaths,
    accountedForPaths,
    semanticPathCount,
    structuralPathCount,
    textualPathCount,
    metadataPathCount,
    binaryPathCount,
    generatedPathCount,
    vendoredPathCount,
    protectedPathCount,
    unreadablePathCount,
    analyzerFailurePathCount,
    materializationMismatchCount: materializationMismatches.length,
    accountingCoveragePercent: percent(accountedForPaths, trackedGitPaths),
    semanticCoveragePercent: percent(semanticPathCount, trackedGitPaths),
    structuralCoveragePercent: percent(structuralPathCount, trackedGitPaths),
    fallbackCoveragePercent: percent(fallbackPathCount, trackedGitPaths),
    claimsSemanticAnalysisOfAllFiles,
    analyzerFailures,
    unreadablePaths,
    materializationMismatches,
  };
}
