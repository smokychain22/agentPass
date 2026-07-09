import type { FindingsPayload } from "./types";

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

const PROGRESS: FindingsPhase[] = [
  "preparing",
  "duplicates",
  "unused",
  "graph",
  "slop",
  "normalizing",
];

export async function runFindingsAnalysis(
  repoUrl: string,
  branch: string | undefined,
  onPhase: (phase: FindingsPhase) => void
): Promise<FindingsPayload> {
  onPhase("preparing");

  let idx = 0;
  const timer = setInterval(() => {
    if (idx < PROGRESS.length - 1) {
      idx += 1;
      onPhase(PROGRESS[idx]);
    }
  }, 1200);

  try {
    const res = await fetch("/api/findings/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repoUrl: repoUrl.trim(),
        branch: branch?.trim() || undefined,
      }),
    });

    const json = (await res.json()) as {
      success: boolean;
      findings?: FindingsPayload;
      error?: string;
    };

    if (!json.success || !json.findings) {
      throw new Error(json.error ?? "Findings analysis failed.");
    }

    onPhase("complete");
    return json.findings;
  } catch (err) {
    onPhase("failed");
    throw err;
  } finally {
    clearInterval(timer);
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
  return `${CLEANUP_PROMPT_PREFIX}

Repository: ${payload.repo.owner}/${payload.repo.name} (${payload.repo.branch})
Scan ID: ${payload.scanId}

Summary:
- Duplicate clusters: ${s.duplicateClusters}
- Unused files: ${s.unusedFiles}
- Unused dependencies: ${s.unusedDependencies}
- Unused exports: ${s.unusedExports}
- Orphan patterns: ${s.orphanPatterns}
- AI-slop signals: ${s.slopSignals}
- Review required: ${s.reviewRequired}
- Safe candidates: ${s.safeCandidates}

Tools: knip=${payload.rawToolReports.knipAvailable}, jscpd=${payload.rawToolReports.jscpdAvailable}, madge=${payload.rawToolReports.madgeAvailable}`;
}
