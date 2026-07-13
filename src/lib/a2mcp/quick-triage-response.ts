import { flattenFindings } from "@/lib/findings/client";
import { sortFindingsByPriority } from "@/lib/findings/evidence-gate";
import { computeCanonicalStats } from "@/lib/findings/stats";
import type { Finding, FindingsPayload } from "@/lib/findings/types";

export interface QuickTriageFinding {
  id: string;
  type: Finding["type"];
  title: string;
  action: Finding["action"];
  confidence: number;
  severity: Finding["severity"];
  files: string[];
  packageName?: string;
  evidenceSummary: string;
  priorityScore?: number;
}

export interface QuickTriageResult {
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
    severity: finding.severity,
    files: finding.files,
    ...(finding.packageName ? { packageName: finding.packageName } : {}),
    evidenceSummary: finding.evidence.summary,
    ...(finding.priorityScore != null ? { priorityScore: finding.priorityScore } : {}),
  };
}

export function buildQuickTriageResult(
  analyzed: FindingsPayload,
  maximumFindings: number
): QuickTriageResult {
  const limit = Math.max(1, Math.min(10, Math.floor(maximumFindings)));
  const allFindings = sortFindingsByPriority(flattenFindings(analyzed));
  const returned = allFindings.slice(0, limit);
  const returnedStats = computeCanonicalStats(returned);
  const internalStats = computeCanonicalStats(allFindings);

  return {
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
