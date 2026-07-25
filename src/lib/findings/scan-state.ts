import type { FindingsPayload } from "./types";
import type { FindingsPhase } from "./client";
import type { AnalysisErrorContract } from "./analysis-errors";

/**
 * The single truthful state for the combined structure-scan + findings-analysis
 * pipeline. Never render zero counters or "awaiting scan results" once analysis
 * has genuinely started — derive one of these instead.
 */
export type ScanFindingsState =
  | "connecting_repository"
  | "resolving_commit"
  | "inventorying"
  | "analysing_findings"
  | "partial"
  | "complete_with_findings"
  | "complete_with_zero_findings"
  | "failed"
  | "stale"
  | "unavailable";

const EARLY_FINDINGS_PHASES: FindingsPhase[] = [
  "queued",
  "dispatching",
  "dispatched",
  "waiting_runner",
  "claimed",
  "preparing_archive",
  "downloading_archive",
  "archive_ready",
];

export function deriveScanFindingsState(input: {
  scanComplete: boolean;
  findings: FindingsPayload | null;
  findingsAnalysisPhase: FindingsPhase;
  findingsAnalysisError: AnalysisErrorContract | null;
  stale?: boolean;
}): ScanFindingsState {
  if (input.stale) return "stale";
  if (!input.scanComplete) return "connecting_repository";

  if (input.findings) {
    // A durable result exists — trust it over any leftover in-flight phase.
    if (input.findings.summary.totalFindings === 0) return "complete_with_zero_findings";
    return input.findings.scanCoverageWarning ? "partial" : "complete_with_findings";
  }

  if (input.findingsAnalysisError) {
    return input.findingsAnalysisError.retryable === false ? "unavailable" : "failed";
  }

  if (EARLY_FINDINGS_PHASES.includes(input.findingsAnalysisPhase)) {
    return "resolving_commit";
  }
  if (input.findingsAnalysisPhase === "inventory") return "inventorying";

  // idle (about to auto-trigger), or any of resolving/graph/running_*/analyzers/
  // normalizing/validating/persisting/baseline/ready-without-a-payload-yet.
  return "analysing_findings";
}

export function scanFindingsStateLabel(state: ScanFindingsState): string {
  switch (state) {
    case "connecting_repository":
      return "Connecting repository";
    case "resolving_commit":
      return "Resolving exact commit";
    case "inventorying":
      return "Inventorying repository";
    case "analysing_findings":
      return "Analysing repository findings";
    case "partial":
      return "Partial results — bounded coverage";
    case "complete_with_findings":
      return "Analysis complete";
    case "complete_with_zero_findings":
      return "Analysis complete — no findings";
    case "failed":
      return "Analysis failed — retryable";
    case "stale":
      return "Repository moved — rescan required";
    case "unavailable":
      return "Analysis unavailable";
  }
}

/** True only for states where showing finding counters would be honest. */
export function scanFindingsStateHasCounters(state: ScanFindingsState): boolean {
  return state === "complete_with_findings" || state === "complete_with_zero_findings" || state === "partial";
}
