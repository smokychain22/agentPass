import type { ScanPhase } from "@/lib/scan";
import type { FindingsPhase } from "@/lib/findings/client";

export interface ResultsReadinessScan {
  phase: ScanPhase | "idle";
  repo?: { commitSha?: string | null } | null;
}

export interface ResultsReadinessActiveRepository {
  commitSha?: string | null;
}

/**
 * Single authoritative readiness check for exposing repository-scan results.
 * "Open Results" (or any results view) must never render before the scan has
 * genuinely completed, findings analysis has reached its terminal "ready"
 * state with a real payload, and the analyzed commit still matches whatever
 * repository/commit is currently active in the session. Do not duplicate
 * this logic in individual components — import and call this instead.
 */
export function canOpenResults(input: {
  scan: ResultsReadinessScan | null;
  findings: unknown | null | undefined;
  findingsAnalysisPhase: FindingsPhase;
  findingsAnalysisError?: unknown;
  activeRepository?: ResultsReadinessActiveRepository | null;
}): boolean {
  const { scan, findings, findingsAnalysisPhase, findingsAnalysisError, activeRepository } = input;

  if (!scan || scan.phase !== "complete") return false;
  if (findingsAnalysisError) return false;
  if (findingsAnalysisPhase !== "ready") return false;
  if (!findings) return false;

  const scanCommit = scan.repo?.commitSha;
  const activeCommit = activeRepository?.commitSha;
  if (scanCommit && activeCommit && scanCommit !== activeCommit) return false;

  return true;
}
