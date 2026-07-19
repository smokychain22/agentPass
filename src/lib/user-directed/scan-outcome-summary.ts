import type { Finding, FindingsPayload } from "@/lib/findings/types";
import {
  isCleanupEligible,
  isProtectedFinding,
  riskBucketOf,
} from "@/lib/findings/cleanup-eligibility";
import { flattenFindingsPayload } from "@/lib/findings/selection";

export interface ScanOutcomeSummary {
  safeRemovals: number;
  duplicateConsolidations: number;
  referencesToUpdate: number;
  filesRequiringEdits: number;
  itemsNeedingDecision: number;
  protectedPaths: number;
  predictedFilesChanged: number;
  predictedLinesRemoved: number;
  eligibleFindingIds: string[];
  reviewFindingIds: string[];
  totalFindings: number;
}

function isDuplicateConsolidation(finding: Finding): boolean {
  return (
    finding.type === "duplicate_code" &&
    (finding.evidence.signals?.includes("exact_file_duplicate=true") ||
      isCleanupEligible(finding))
  );
}

function needsReferenceUpdate(finding: Finding): boolean {
  if (!isCleanupEligible(finding)) return false;
  return (
    finding.type === "duplicate_code" ||
    finding.type === "unused_import" ||
    (finding.evidence.signals ?? []).some((s) => /reference|import.?update/i.test(s))
  );
}

function needsEdit(finding: Finding): boolean {
  if (!isCleanupEligible(finding)) return false;
  return finding.type === "unused_import" || finding.type === "unused_export";
}

function estimatedLinesRemoved(finding: Finding): number {
  if (finding.lines?.start != null && finding.lines?.end != null) {
    return Math.max(1, finding.lines.end - finding.lines.start + 1);
  }
  if (finding.type === "unused_file") return 40;
  if (finding.type === "unused_dependency") return 1;
  if (finding.type === "duplicate_code") return 25;
  if (finding.type === "unused_import") return 1;
  return 8;
}

export function buildScanOutcomeSummary(
  findings: FindingsPayload | Finding[] | null | undefined
): ScanOutcomeSummary {
  const flat = Array.isArray(findings)
    ? findings
    : findings
      ? flattenFindingsPayload(findings)
      : [];

  const eligible = flat.filter(isCleanupEligible);
  const review = flat.filter(
    (f) => riskBucketOf(f) === "REVIEW" && !isCleanupEligible(f)
  );
  const protectedCount = flat.filter(isProtectedFinding).length;

  const safeRemovals = eligible.filter(
    (f) =>
      f.type === "unused_file" ||
      f.type === "orphan_pattern" ||
      (f.type === "unused_dependency" && isCleanupEligible(f))
  ).length;

  const duplicateConsolidations = eligible.filter(isDuplicateConsolidation).length;
  const referencesToUpdate = eligible.filter(needsReferenceUpdate).length;
  const filesRequiringEdits = eligible.filter(needsEdit).length;

  const predictedFilesChanged = new Set(
    eligible.flatMap((f) => f.files.map((p) => p.replace(/\\/g, "/")))
  ).size;

  const predictedLinesRemoved = eligible.reduce(
    (sum, f) => sum + estimatedLinesRemoved(f),
    0
  );

  return {
    safeRemovals,
    duplicateConsolidations,
    referencesToUpdate,
    filesRequiringEdits,
    itemsNeedingDecision: review.length,
    protectedPaths: protectedCount,
    predictedFilesChanged,
    predictedLinesRemoved,
    eligibleFindingIds: eligible.map((f) => f.id),
    reviewFindingIds: review.map((f) => f.id),
    totalFindings: flat.length,
  };
}
