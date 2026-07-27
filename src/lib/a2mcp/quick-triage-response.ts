import { flattenFindings } from "@/lib/findings/client";
import { sortFindingsByPriority } from "@/lib/findings/evidence-gate";
import { computeCanonicalStats } from "@/lib/findings/stats";
import type { Finding, FindingsPayload } from "@/lib/findings/types";
import type { QuickTriageCoverage } from "@/lib/a2mcp/quick-triage-bounded";

export type QuickTriageEffort = "trivial" | "small" | "moderate";

export interface QuickTriageFinding {
  id: string;
  type: Finding["type"];
  title: string;
  action: Finding["action"];
  confidence: number;
  confidenceReason: string;
  severity: Finding["severity"];
  files: string[];
  lines?: { start: number; end: number };
  packageName?: string;
  evidenceSummary: string;
  evidenceSignals: string[];
  explanation: string;
  userImpact: string;
  recommendedFix: string;
  estimatedEffort: QuickTriageEffort;
  safeForAutomaticCleanup: boolean;
  eligibleForA2AService37348: boolean;
  priorityScore?: number;
}

const USER_IMPACT_BY_TYPE: Record<Finding["type"], string> = {
  duplicate_code:
    "Duplicated logic must be updated in every copy when behavior changes, so fixes and bugs silently diverge across copies over time.",
  unused_file:
    "Dead code stays in the repository, inflating review and audit surface without providing runtime functionality.",
  unused_dependency:
    "Increases install size, attack surface, and dependency-audit burden for a package that is not actually used.",
  unused_export:
    "The export is publicly surfaced from its module but never consumed, misleading readers about the module's real API surface.",
  unused_import:
    "The import is loaded at build/runtime for no reason, adding unnecessary module-graph weight.",
  orphan_pattern:
    "The file is disconnected from the rest of the codebase's import graph, so it likely no longer participates in the running application.",
  ai_slop_signal:
    "Leftover iteration artifacts (backups, copies, versioned filenames) make it harder for future maintainers to tell which file is the real, current implementation.",
};

function recommendedFixFor(finding: Finding): string {
  const file = finding.files[0];
  switch (finding.type) {
    case "unused_dependency":
      return `Confirm "${finding.packageName ?? "the package"}" has no remaining usage, then remove it from ${finding.manifestPath ?? "package.json"}.`;
    case "unused_file":
    case "orphan_pattern":
      return `Confirm ${file} has no dynamic or string-based references, then delete the file.`;
    case "ai_slop_signal":
      return `Review ${finding.files.length > 1 ? "these files" : file} and delete them if the current, canonical version already exists elsewhere.`;
    case "duplicate_code":
      return `Extract the shared logic in ${finding.files.length > 1 ? finding.files.join(" and ") : file} into a single reusable location.`;
    case "unused_export":
      return `Remove the unused export from ${file}, or delete it if no other module is expected to consume it.`;
    case "unused_import":
      return `Remove the unused import statement from ${file}.`;
    default:
      return `Review ${file} manually before making any change.`;
  }
}

function estimatedEffortFor(finding: Finding): QuickTriageEffort {
  if (finding.action === "do_not_touch") return "moderate";
  if (finding.files.length > 2) return "moderate";
  if (finding.action === "safe_candidate" && finding.files.length === 1) return "trivial";
  return "small";
}

export interface QuickTriageResult {
  status?: "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
  coverage?: QuickTriageCoverage;
  recommendedNextAction?: string;
  scanId: string;
  summary: {
    totalFindingsDetected: number;
    findingsReturned: number;
    safeCandidates: number;
    reviewFirst: number;
    protected: number;
  };
  internalScan: {
    totalFindings: number;
    findingCounts: {
      duplicates: number;
      unusedFiles: number;
      unusedDependencies: number;
      orphans: number;
      slopSignals: number;
    };
    riskBuckets: {
      safeCandidates: number;
      reviewFirst: number;
      protected: number;
    };
  };
  findings: QuickTriageFinding[];
}

function toQuickTriageFinding(finding: Finding): QuickTriageFinding {
  return {
    id: finding.id,
    type: finding.type,
    title: finding.title,
    action: finding.action,
    confidence: finding.confidence,
    confidenceReason: finding.confidenceReason,
    severity: finding.severity,
    files: finding.files,
    ...(finding.lines ? { lines: finding.lines } : {}),
    ...(finding.packageName ? { packageName: finding.packageName } : {}),
    evidenceSummary: finding.evidence.summary,
    evidenceSignals: finding.evidence.signals,
    explanation: finding.reason,
    userImpact: USER_IMPACT_BY_TYPE[finding.type],
    recommendedFix: finding.suggestedAction ?? recommendedFixFor(finding),
    estimatedEffort: estimatedEffortFor(finding),
    safeForAutomaticCleanup: finding.action === "safe_candidate",
    eligibleForA2AService37348: finding.action !== "do_not_touch",
    ...(finding.priorityScore != null ? { priorityScore: finding.priorityScore } : {}),
  };
}

export function buildQuickTriageResult(
  analyzed: FindingsPayload,
  maximumFindings: number,
  meta?: {
    status?: "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
    coverage?: QuickTriageResult["coverage"];
    recommendedNextAction?: string;
  }
): QuickTriageResult {
  const limit = Math.max(1, Math.min(10, Math.floor(maximumFindings)));
  const allFindings = sortFindingsByPriority(flattenFindings(analyzed));
  const returned = allFindings.slice(0, limit);
  const returnedStats = computeCanonicalStats(returned);
  const internalStats = computeCanonicalStats(allFindings);

  return {
    ...(meta?.status ? { status: meta.status } : {}),
    ...(meta?.coverage ? { coverage: meta.coverage } : {}),
    ...(meta?.recommendedNextAction ? { recommendedNextAction: meta.recommendedNextAction } : {}),
    scanId: analyzed.scanId,
    summary: {
      totalFindingsDetected: internalStats.totalFindings,
      findingsReturned: returned.length,
      safeCandidates: returnedStats.safeCandidateCount,
      reviewFirst: returnedStats.reviewFirstCount,
      protected: returnedStats.doNotTouchCount,
    },
    internalScan: {
      totalFindings: internalStats.totalFindings,
      findingCounts: {
        duplicates: internalStats.duplicateCount,
        unusedFiles: internalStats.unusedFileCount,
        unusedDependencies: internalStats.unusedDependencyCount,
        orphans: internalStats.orphanCount,
        slopSignals: internalStats.slopSignalCount,
      },
      riskBuckets: {
        safeCandidates: internalStats.safeCandidateCount,
        reviewFirst: internalStats.reviewFirstCount,
        protected: internalStats.doNotTouchCount,
      },
    },
    findings: returned.map(toQuickTriageFinding),
  };
}

export function assertQuickTriageSummaryInvariants(result: QuickTriageResult): void {
  const { summary } = result;
  const bucketSum = summary.safeCandidates + summary.reviewFirst + summary.protected;
  if (bucketSum !== summary.findingsReturned) {
    throw new Error(
      `Quick triage summary bucket sum ${bucketSum} !== findingsReturned ${summary.findingsReturned}`
    );
  }
  if (result.findings.length !== summary.findingsReturned) {
    throw new Error(
      `Quick triage findings length ${result.findings.length} !== findingsReturned ${summary.findingsReturned}`
    );
  }
  if (summary.findingsReturned > summary.totalFindingsDetected) {
    throw new Error(
      `Quick triage findingsReturned ${summary.findingsReturned} exceeds totalFindingsDetected ${summary.totalFindingsDetected}`
    );
  }
}
