import type { Finding, FindingsPayload, FindingsSummary, ToolRunReport } from "./types";
import { countActionableFindings } from "./actionability-signals";
import { flattenFindings } from "./client";

export interface CanonicalFindingsStats {
  totalFindings: number;
  reviewFirstCount: number;
  safeCandidateCount: number;
  doNotTouchCount: number;
  duplicateCount: number;
  unusedFileCount: number;
  unusedDependencyCount: number;
  unusedExportCount: number;
  orphanCount: number;
  slopSignalCount: number;
}

export function computeCanonicalStats(findings: Finding[]): CanonicalFindingsStats {
  const duplicateCount = findings.filter((f) => f.type === "duplicate_code").length;
  const unusedFileCount = findings.filter((f) => f.type === "unused_file").length;
  const unusedDependencyCount = findings.filter((f) => f.type === "unused_dependency").length;
  const unusedExportCount = findings.filter((f) => f.type === "unused_export").length;
  const orphanCount = findings.filter((f) => f.type === "orphan_pattern").length;
  const slopSignalCount = findings.filter((f) => f.type === "ai_slop_signal").length;

  const reviewFirstCount = findings.filter((f) => f.action === "review_first").length;
  const safeCandidateCount = findings.filter((f) => f.action === "safe_candidate").length;
  const doNotTouchCount = findings.filter((f) => f.action === "do_not_touch").length;

  return {
    totalFindings: findings.length,
    reviewFirstCount,
    safeCandidateCount,
    doNotTouchCount,
    duplicateCount,
    unusedFileCount,
    unusedDependencyCount,
    unusedExportCount,
    orphanCount,
    slopSignalCount,
  };
}

export function buildSummaryFromFindings(findings: Finding[]): FindingsSummary {
  const stats = computeCanonicalStats(findings);
  const actionableFixes = findings.filter((f) =>
    f.evidence.signals.some((s) => s === "classification=actionable_candidate")
  ).length;
  return {
    totalFindings: stats.totalFindings,
    duplicateClusters: stats.duplicateCount,
    unusedFiles: stats.unusedFileCount,
    unusedDependencies: stats.unusedDependencyCount,
    unusedExports: stats.unusedExportCount,
    orphanPatterns: stats.orphanCount,
    slopSignals: stats.slopSignalCount,
    reviewRequired: stats.reviewFirstCount,
    safeCandidates: stats.safeCandidateCount,
    actionableFixes,
    detectedFindings: stats.totalFindings,
    doNotTouch: stats.doNotTouchCount,
  };
}

export function assertFindingsInvariants(payload: FindingsPayload): void {
  const flat = flattenFindings(payload);
  const stats = computeCanonicalStats(flat);

  if (stats.totalFindings !== flat.length) {
    throw new Error(`Invariant: totalFindings ${stats.totalFindings} !== flat length ${flat.length}`);
  }

  const bucketSum = stats.reviewFirstCount + stats.safeCandidateCount + stats.doNotTouchCount;
  if (bucketSum !== stats.totalFindings) {
    throw new Error(
      `Invariant: bucket sum ${bucketSum} !== totalFindings ${stats.totalFindings}`
    );
  }

  const categorySum =
    stats.duplicateCount +
    stats.unusedFileCount +
    stats.unusedDependencyCount +
    stats.unusedExportCount +
    stats.orphanCount +
    stats.slopSignalCount;

  if (categorySum !== stats.totalFindings) {
    throw new Error(
      `Invariant: category sum ${categorySum} !== totalFindings ${stats.totalFindings}`
    );
  }

  const summary = payload.summary;
  if (summary.totalFindings !== stats.totalFindings) {
    throw new Error(
      `Invariant: summary.totalFindings ${summary.totalFindings} !== computed ${stats.totalFindings}`
    );
  }
}

export function metricLabel(
  metric:
    | "duplicates"
    | "unusedFiles"
    | "orphans"
    | "dependencies"
    | "slop",
  report?: ToolRunReport
): { title: string; subtitle: string } {
  const fallback = report?.sourceMode === "fallback" || report?.status === "fallback";

  switch (metric) {
    case "duplicates":
      return {
        title: fallback ? "Potential Duplicates" : "Duplicate Clusters",
        subtitle: fallback
          ? "Internal duplicate detector (estimated)"
          : "jscpd native analysis",
      };
    case "unusedFiles":
      return {
        title: fallback ? "Potentially Unreferenced" : "Unused Files",
        subtitle: fallback
          ? "Fallback import-graph estimate"
          : "Knip unused-file analysis",
      };
    case "orphans":
      return {
        title: fallback ? "Potential Orphan Modules" : "Orphan Patterns",
        subtitle: fallback
          ? "Internal dependency-graph estimate"
          : "Madge graph analysis",
      };
    case "dependencies":
      return {
        title: "Unused Dependencies",
        subtitle: fallback ? "Fallback package import scan" : "Knip dependency audit",
      };
    case "slop":
      return {
        title: "AI-Slop Signals",
        subtitle: "Native internal heuristic engine",
      };
  }
}

export function analyzerSourceLabel(report: ToolRunReport): {
  name: string;
  mode: "Native" | "Fallback" | "Failed";
  detail: string;
} {
  if (report.status === "failed") {
    return { name: "Unavailable", mode: "Failed", detail: report.error ?? "Analyzer failed" };
  }

  if (report.status === "ok" && report.sourceMode === "native") {
    const nativeName =
      report.source === "knip" ? "Knip" : report.source === "jscpd" ? "jscpd" : "Madge";
    return { name: nativeName, mode: "Native", detail: `Completed in ${report.durationMs}ms` };
  }

  const fallbackName =
    report.source === "internal_duplicate_detector"
      ? "Internal duplicate detector"
      : report.source === "internal_import_graph"
        ? "Internal import graph"
        : report.source === "internal_dependency_graph"
          ? "Internal dependency graph"
          : "Internal fallback analyzer";

  return {
    name: fallbackName,
    mode: "Fallback",
    detail: report.error ? `Fallback: ${report.error}` : `Completed in ${report.durationMs}ms`,
  };
}
