import type { Finding, FindingType, ToolRunReport } from "./types";
import { unavailableMessage } from "./analyzer-availability";

export type AnalyzerDisplayMode = "native" | "fallback" | "failed";

export function analyzerModeFromReport(report?: ToolRunReport): AnalyzerDisplayMode {
  if (!report || report.status === "failed") return "failed";
  if (report.status === "ok" && report.sourceMode === "native") return "native";
  return "fallback";
}

export function isNativeReport(report?: ToolRunReport): boolean {
  return analyzerModeFromReport(report) === "native";
}

export function reportForFindingType(
  type: FindingType,
  reports: {
    knip: ToolRunReport;
    jscpd: ToolRunReport;
    madge: ToolRunReport;
  }
): ToolRunReport | undefined {
  switch (type) {
    case "duplicate_code":
      return reports.jscpd;
    case "unused_file":
    case "unused_dependency":
    case "unused_export":
    case "unused_import":
      return reports.knip;
    case "orphan_pattern":
      return reports.madge;
    default:
      return undefined;
  }
}

export function findingAnalyzerLabel(
  finding: Finding,
  reports?: {
    knip: ToolRunReport;
    jscpd: ToolRunReport;
    madge: ToolRunReport;
  }
): { name: string; mode: AnalyzerDisplayMode } {
  const report = reports ? reportForFindingType(finding.type, reports) : undefined;
  const mode =
    finding.sourceMode === "heuristic"
      ? "native"
      : report
        ? analyzerModeFromReport(report)
        : finding.sourceMode === "native"
          ? "native"
          : finding.source.endsWith("_fallback")
            ? "fallback"
            : "failed";

  if (finding.type === "ai_slop_signal") {
    return { name: "RepoDiet heuristic", mode: "native" };
  }

  if (mode === "native") {
    if (finding.type === "duplicate_code") return { name: "jscpd", mode };
    if (
      finding.type === "unused_file" ||
      finding.type === "unused_dependency" ||
      finding.type === "unused_export" ||
      finding.type === "unused_import"
    ) {
      return { name: "Knip", mode };
    }
    if (finding.type === "orphan_pattern") return { name: "Madge", mode };
  }

  if (mode === "fallback") {
    if (finding.type === "duplicate_code") {
      return { name: "Internal duplicate detector", mode };
    }
    if (
      finding.type === "unused_file" ||
      finding.type === "unused_dependency" ||
      finding.type === "unused_export" ||
      finding.type === "unused_import"
    ) {
      return { name: "Internal import graph", mode };
    }
    if (finding.type === "orphan_pattern") {
      return { name: "Internal dependency graph", mode };
    }
  }

  return { name: "Unavailable", mode: "failed" };
}

export function metricSubtitleForReport(
  metric: "duplicates" | "unusedFiles" | "orphans" | "dependencies",
  report?: ToolRunReport
): { title: string; subtitle: string } {
  const mode = analyzerModeFromReport(report);
  switch (metric) {
    case "duplicates":
      return mode === "native"
        ? { title: "Duplicate Clusters", subtitle: "jscpd · Native" }
        : mode === "fallback"
          ? {
              title: "Potential Duplicates",
              subtitle: "Internal duplicate detector · Fallback",
            }
          : { title: "Duplicate Clusters", subtitle: "Duplicate detector · Failed" };
    case "unusedFiles":
      return mode === "native"
        ? { title: "Unused Files", subtitle: "Knip · Native" }
        : mode === "fallback"
          ? { title: "Potentially Unreferenced", subtitle: "Internal import graph · Fallback" }
          : { title: "Unused Files", subtitle: "Unused-code detector · Failed" };
    case "dependencies":
      return mode === "native"
        ? { title: "Unused Dependencies", subtitle: "Knip · Native" }
        : mode === "fallback"
          ? { title: "Unused Dependencies", subtitle: "Internal import graph · Fallback" }
          : { title: "Unused Dependencies", subtitle: "Dependency audit · Failed" };
    case "orphans":
      return mode === "native"
        ? { title: "Orphan Patterns", subtitle: "Madge · Native" }
        : mode === "fallback"
          ? { title: "Potential Orphan Modules", subtitle: "Internal dependency graph · Fallback" }
          : { title: "Orphan Patterns", subtitle: "Dependency graph · Failed" };
  }
}

export function findingsAnalyzerWarning(reports: {
  knip: ToolRunReport;
  jscpd: ToolRunReport;
  madge: ToolRunReport;
}): string | null {
  const lines: string[] = [];
  const entries = [
    { key: "Knip", report: reports.knip, tool: "knip" as const },
    { key: "jscpd", report: reports.jscpd, tool: "jscpd" as const },
    { key: "Madge", report: reports.madge, tool: "madge" as const },
  ];
  for (const entry of entries) {
    const mode = analyzerModeFromReport(entry.report);
    if (mode === "fallback" || mode === "failed") {
      lines.push(unavailableMessage(entry.tool));
    }
  }
  if (!lines.length) return null;
  return lines.join(" ");
}
