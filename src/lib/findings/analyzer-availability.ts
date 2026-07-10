import type { AnalyzerRunResult, Finding, FindingType, ToolRunReport } from "./types";

export type AnalyzerAvailabilityStatus = "available" | "unavailable" | "failed";

export interface AnalyzerState {
  status: AnalyzerAvailabilityStatus;
  tool: "knip" | "jscpd" | "madge" | "repodiet_heuristics";
  version?: string;
  command?: string;
  exitCode?: number | null;
  durationMs: number;
  errorSummary?: string;
}

const TOOL_COMMAND: Record<"knip" | "jscpd" | "madge", string> = {
  knip: "node node_modules/knip/bin/knip.js --reporter json --no-progress",
  jscpd: "node node_modules/jscpd/run-jscpd.js",
  madge: "node scripts/madge-scan.mjs",
};

function summarizeError(error?: string): string | undefined {
  if (!error) return undefined;
  const first = error.split("\n").find((l) => l.trim()) ?? error;
  return first.length > 240 ? `${first.slice(0, 237)}...` : first;
}

function parseExitCode(error?: string): number | null | undefined {
  if (!error) return undefined;
  const match = error.match(/exited?\s+(\d+)/i) ?? error.match(/exitCode[:\s]+(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

export function buildAnalyzerState(
  tool: "knip" | "jscpd" | "madge",
  result: AnalyzerRunResult<unknown>
): AnalyzerState {
  const nativeOk = result.status === "ok" && result.sourceMode === "native";
  const status: AnalyzerAvailabilityStatus = nativeOk
    ? "available"
    : result.status === "failed"
      ? "failed"
      : "unavailable";

  return {
    status,
    tool,
    version: result.version,
    command: TOOL_COMMAND[tool],
    exitCode: nativeOk ? 0 : parseExitCode(result.error) ?? (result.status === "failed" ? 1 : null),
    durationMs: result.durationMs,
    errorSummary: nativeOk ? undefined : summarizeError(result.error),
  };
}

export function buildHeuristicsState(): AnalyzerState {
  return {
    status: "available",
    tool: "repodiet_heuristics",
    durationMs: 0,
  };
}

export function isAnalyzerAvailableForFindingType(
  type: FindingType,
  reports: { knip: ToolRunReport; jscpd: ToolRunReport; madge: ToolRunReport }
): boolean {
  switch (type) {
    case "duplicate_code":
      return reports.jscpd.status === "ok" && reports.jscpd.sourceMode === "native";
    case "unused_file":
    case "unused_dependency":
    case "unused_export":
    case "unused_import":
      return reports.knip.status === "ok" && reports.knip.sourceMode === "native";
    case "orphan_pattern":
      return reports.madge.status === "ok" && reports.madge.sourceMode === "native";
    case "ai_slop_signal":
      return true;
    default:
      return false;
  }
}

export function isKnipAvailable(reports: { knip: ToolRunReport }): boolean {
  return reports.knip.status === "ok" && reports.knip.sourceMode === "native";
}

export function isProductFinding(finding: Finding, reports: {
  knip: ToolRunReport;
  jscpd: ToolRunReport;
  madge: ToolRunReport;
}): boolean {
  if (finding.source.endsWith("_fallback")) return false;
  if (finding.sourceMode === "fallback") return false;
  return isAnalyzerAvailableForFindingType(finding.type, reports);
}

export function filterProductFindings(
  findings: Finding[],
  reports: { knip: ToolRunReport; jscpd: ToolRunReport; madge: ToolRunReport }
): { product: Finding[]; excluded: Finding[] } {
  const product: Finding[] = [];
  const excluded: Finding[] = [];
  for (const finding of findings) {
    if (isProductFinding(finding, reports)) product.push(finding);
    else excluded.push(finding);
  }
  return { product, excluded };
}

export function availabilityLabel(state: AnalyzerState): string {
  if (state.status === "available") {
    const version = state.version ? ` v${state.version}` : "";
    return `Available${version}`;
  }
  if (state.status === "failed") return "Failed";
  return "Unavailable";
}

export function unavailableMessage(tool: "knip" | "madge" | "jscpd"): string {
  switch (tool) {
    case "knip":
      return "Unused-code analysis unavailable. Knip could not run in the production environment. RepoDiet did not generate unused-file or unused-dependency findings.";
    case "madge":
      return "Dependency graph analysis unavailable. Madge could not run in the production environment. RepoDiet did not generate orphan-module findings.";
    case "jscpd":
      return "Duplicate analysis unavailable. jscpd could not run in the production environment. RepoDiet did not generate duplicate-code findings.";
  }
}
