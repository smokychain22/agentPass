import type { Finding, FindingsPayload } from "@/lib/findings/types";

export function filterFindingsBySelection(
  findings: FindingsPayload,
  selectedFindingIds?: string[]
): FindingsPayload {
  if (!selectedFindingIds?.length) return findings;

  const selected = new Set(selectedFindingIds);
  const keep = (items: Finding[]) => items.filter((item) => selected.has(item.id));

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
    summary: {
      duplicateClusters: duplicates.length,
      unusedFiles: unusedFiles.length,
      unusedDependencies: unusedDeps.length,
      unusedExports: unusedExports.length,
      orphanPatterns: orphans.length,
      slopSignals: slopSignals.length,
      reviewRequired: all.filter((f) => f.action === "review_first").length,
      safeCandidates: all.filter((f) => f.action === "safe_candidate").length,
    },
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
