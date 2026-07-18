import {
  assertValidTerminalOutcome,
  isForbiddenBareOutcome,
  type TerminalCoverageOutcome,
} from "./outcomes";
import type { UniversalCoverageReport } from "./types";

function inventoryKey(entry: {
  owner: string;
  repository: string;
  pinnedCommitSha: string;
  pathExact: string;
}): string {
  return `${entry.owner}/${entry.repository}@${entry.pinnedCommitSha}:${entry.pathExact}`;
}

/**
 * Enforces Phase 1 universal-coverage accounting invariants.
 * Throws on the first violation.
 */
export function assertCoverageInvariants(report: UniversalCoverageReport): void {
  if (report.coverageVersion === "phase1") {
    if (report.trackedGitPaths !== report.accountedForPaths) {
      throw new Error(
        `coverage_invariant:tracked_ne_accounted:${report.trackedGitPaths}!=${report.accountedForPaths}`
      );
    }
    if (report.accountedForPaths !== report.inventory.length) {
      throw new Error(
        `coverage_invariant:accounted_ne_inventory:${report.accountedForPaths}!=${report.inventory.length}`
      );
    }
  }

  const seen = new Set<string>();
  for (const entry of report.inventory) {
    const outcome = entry.finalCoverageOutcome as string;
    if (isForbiddenBareOutcome(outcome)) {
      throw new Error(`coverage_invariant:forbidden_bare_outcome:${entry.pathExact}:${outcome}`);
    }
    assertValidTerminalOutcome(outcome);

    const key = inventoryKey(entry);
    if (seen.has(key)) {
      throw new Error(`coverage_invariant:duplicate_pathExact:${key}`);
    }
    seen.add(key);
  }

  if (report.claimsSemanticAnalysisOfAllFiles) {
    const allSemantic = report.inventory.every(
      (entry) =>
        (entry.finalCoverageOutcome as TerminalCoverageOutcome) === "SEMANTICALLY_ANALYZED"
    );
    if (!allSemantic) {
      throw new Error("coverage_invariant:claims_semantic_without_full_semantic_inventory");
    }
  }
}
