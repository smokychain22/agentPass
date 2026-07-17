import type { Finding, FindingsPayload } from "@/lib/findings/types";
import { buildSummaryFromFindings } from "@/lib/findings/stats";
import {
  assertValidCleanupSelection,
  FindingSelectionValidationError,
} from "@/lib/findings/selection";
import { isCleanupEligible } from "@/lib/findings/cleanup-eligibility";

export { FindingSelectionValidationError };

export function filterFindingsBySelection(
  findings: FindingsPayload,
  selectedFindingIds?: string[]
): FindingsPayload {
  if (!selectedFindingIds?.length) return findings;

  const selected = new Set(selectedFindingIds);
  const keep = (items: Finding[]) =>
    items.filter((item) => selected.has(item.id) && isCleanupEligible(item));

  const duplicates = keep(findings.duplicates);
  const unusedFiles = keep(findings.unused.files);
  const unusedDeps = keep(findings.unused.dependencies);
  const unusedExports = keep(findings.unused.exports);
  const orphans = keep(findings.orphans);
  const slopSignals = keep(findings.slopSignals);

  const all = [
    ...duplicates,
    ...unusedFiles,
    ...unusedDeps,
    ...unusedExports,
    ...orphans,
    ...slopSignals,
  ];

  return {
    ...findings,
    summary: buildSummaryFromFindings(all),
    duplicates,
    unused: {
      files: unusedFiles,
      dependencies: unusedDeps,
      exports: unusedExports,
    },
    orphans,
    slopSignals,
    riskBuckets: {
      safeDelete: all.filter((f) => f.action === "safe_candidate").map((f) => f.id),
      reviewFirst: all.filter((f) => f.action === "review_first").map((f) => f.id),
      doNotTouch: all.filter((f) => f.action === "do_not_touch").map((f) => f.id),
    },
  };
}

/**
 * Validate then filter — rejects non-eligible / unknown / cross-scan IDs.
 */
export function filterFindingsByValidatedSelection(
  findings: FindingsPayload,
  selectedFindingIds: string[],
  options?: {
    expectedScanId?: string;
    expectedRepository?: { owner: string; name: string };
  }
): FindingsPayload {
  assertValidCleanupSelection({
    findings,
    selectedFindingIds,
    expectedScanId: options?.expectedScanId,
    expectedRepository: options?.expectedRepository,
  });
  return filterFindingsBySelection(findings, selectedFindingIds);
}
