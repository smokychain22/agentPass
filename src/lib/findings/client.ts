import type { FindingsPayload } from "./types";
import { pollJob, startJobOrResult } from "@/lib/jobs/client";

export type FindingsPhase =
  | "idle"
  | "preparing"
  | "duplicates"
  | "unused"
  | "graph"
  | "slop"
  | "normalizing"
  | "complete"
  | "failed";

export const FINDINGS_STEPS: { phase: FindingsPhase; label: string }[] = [
  { phase: "preparing", label: "Preparing workspace" },
  { phase: "duplicates", label: "Running duplicate detector" },
  { phase: "unused", label: "Running unused code detector" },
  { phase: "graph", label: "Building dependency graph" },
  { phase: "slop", label: "Applying AI-slop heuristics" },
  { phase: "normalizing", label: "Normalizing findings" },
  { phase: "complete", label: "Complete" },
];

const STAGE_TO_PHASE: Record<string, FindingsPhase> = {
  queued: "preparing",
  fetching_repo: "preparing",
  extracting: "preparing",
  framework_detection: "preparing",
  jscpd: "duplicates",
  knip: "unused",
  madge: "graph",
  heuristics: "slop",
  normalizing: "normalizing",
  complete: "complete",
};

function mapStageToPhase(stage: string): FindingsPhase {
  return STAGE_TO_PHASE[stage] ?? "preparing";
}

export function analyzerStageLabel(report: FindingsPayload["rawToolReports"][keyof FindingsPayload["rawToolReports"]]): string {
  if (report.status === "ok") {
    return report.source === "knip" ? "Knip" : report.source === "jscpd" ? "jscpd" : "Madge";
  }
  if (report.status === "fallback") {
    if (report.source === "internal_import_graph") return "Unused-code fallback";
    if (report.source === "internal_duplicate_detector") return "Duplicate fallback";
    if (report.source === "internal_dependency_graph") return "Dependency-graph fallback";
    return "Fallback analyzer";
  }
  return "Analyzer failed";
}

export async function runFindingsAnalysis(
  repoUrl: string,
  branch: string | undefined,
  onPhase: (phase: FindingsPhase) => void,
  scanId?: string,
  projectRoot?: string
): Promise<FindingsPayload> {
  onPhase("preparing");

  try {
    const started = await startJobOrResult<FindingsPayload>("/api/jobs/findings", {
      repoUrl: repoUrl.trim(),
      branch: branch?.trim() || undefined,
      scanId: scanId?.trim() || undefined,
      projectRoot: projectRoot?.trim() || undefined,
    });

    if (started.result) {
      onPhase("complete");
      return started.result;
    }

    const findings = await pollJob<FindingsPayload>("/api/jobs/findings", started.jobId, (stage) => {
      onPhase(mapStageToPhase(stage));
    });

    onPhase("complete");
    return findings;
  } catch (err) {
    onPhase("failed");
    throw err;
  }
}

export function flattenFindings(payload: FindingsPayload) {
  return [
    ...payload.duplicates,
    ...payload.unused.files,
    ...payload.unused.dependencies,
    ...payload.unused.exports,
    ...payload.orphans,
    ...payload.slopSignals,
  ];
}

export const CLEANUP_PROMPT_PREFIX =
  "Review these RepoDiet findings and propose a conservative cleanup plan. Do not delete framework routes, config files, env files, lockfiles, or public assets without confirmation.";

export function buildCleanupPrompt(payload: FindingsPayload): string {
  const s = payload.summary;
  const safeLine =
    s.safeCandidates === 0
      ? "Safe candidates are 0, so do not generate delete operations yet. Only propose a review plan and group findings by safest-first cleanup order."
      : "Start with safe candidates only, then review remaining items separately.";

  const knipLabel = analyzerStageLabel(payload.rawToolReports.knip);
  const jscpdLabel = analyzerStageLabel(payload.rawToolReports.jscpd);
  const madgeLabel = analyzerStageLabel(payload.rawToolReports.madge);

  return `${CLEANUP_PROMPT_PREFIX}
${safeLine}

Repository: ${payload.repo.owner}/${payload.repo.name} (${payload.repo.branch})
Scan ID: ${payload.scanId}
Mode: ${payload.mode}

Summary:
- Duplicate clusters: ${s.duplicateClusters}
- Unused files: ${s.unusedFiles}
- Unused dependencies: ${s.unusedDependencies}
- Unused exports: ${s.unusedExports}
- Orphan patterns: ${s.orphanPatterns}
- AI-slop signals: ${s.slopSignals}
- Raw review findings: ${s.reviewRequired}
- Candidates for developer review: ${s.safeCandidates}

Analyzers: ${jscpdLabel} (${payload.rawToolReports.jscpd.durationMs}ms), ${knipLabel} (${payload.rawToolReports.knip.durationMs}ms), ${madgeLabel} (${payload.rawToolReports.madge.durationMs}ms)`;
}
