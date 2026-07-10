import { nanoid } from "nanoid";
import { isDemoRepoUrl } from "@/lib/demo/constants";
import { prepareRepoWorkspace } from "@/lib/scanner/prepare-workspace";
import { runKnip } from "./run-knip";
import { runJscpd } from "./run-jscpd";
import { runMadge } from "./run-madge";
import { runAiSlopHeuristics } from "./ai-slop-heuristics";
import { normalizeFindings } from "./normalize-findings";
import { buildSummaryFromFindings } from "./stats";
import type { FindingsPayload, Finding } from "./types";
import type { FindingsJobStage } from "@/lib/jobs/types";

export type FindingsStageCallback = (stage: FindingsJobStage) => void;

export async function runFindingsEngine(
  repoUrl: string,
  branch?: string,
  onStage?: FindingsStageCallback
): Promise<FindingsPayload> {
  onStage?.("fetching_repo");
  const workspace = await prepareRepoWorkspace(repoUrl, branch);

  try {
    onStage?.("extracting");
    onStage?.("framework_detection");

    const scanId = `scan_${nanoid(12)}`;

    onStage?.("jscpd");
    const jscpdResult = await runJscpd(workspace.rootDir);

    onStage?.("knip");
    const knipResult = await runKnip(workspace.rootDir);

    onStage?.("madge");
    const madgeResult = await runMadge(workspace.rootDir);

    onStage?.("heuristics");
    const slopSignals = await runAiSlopHeuristics(workspace.rootDir);

    onStage?.("normalizing");
    const payload = normalizeFindings({
      scanId,
      repo: workspace.repo,
      rootDir: workspace.rootDir,
      knip: knipResult.report,
      knipResult,
      jscpd: jscpdResult.report,
      jscpdResult,
      madge: madgeResult.report,
      madgeResult,
      slop: slopSignals,
      mode: isDemoRepoUrl(repoUrl) ? "demo" : "live",
    });

    onStage?.("complete");
    return payload;
  } finally {
    await workspace.cleanup();
  }
}

export type FindingsCategory =
  | "duplicates"
  | "unused_files"
  | "unused_dependencies"
  | "orphans"
  | "all";

export async function runFindingsCategory(
  repoUrl: string,
  branch: string | undefined,
  category: FindingsCategory
): Promise<FindingsPayload> {
  const full = await runFindingsEngine(repoUrl, branch);

  if (category === "all") return full;

  function withSummary(partial: Partial<FindingsPayload>): FindingsPayload {
    const merged = { ...full, ...partial };
    const flat: Finding[] = [
      ...merged.duplicates,
      ...merged.unused.files,
      ...merged.unused.dependencies,
      ...merged.unused.exports,
      ...merged.orphans,
      ...merged.slopSignals,
    ];
    return { ...merged, summary: buildSummaryFromFindings(flat) };
  }

  if (category === "duplicates") {
    return withSummary({
      duplicates: full.duplicates,
      unused: { files: [], dependencies: [], exports: [] },
      orphans: [],
      slopSignals: [],
      riskBuckets: {
        safeDelete: [],
        reviewFirst: full.duplicates.map((f) => f.id),
        doNotTouch: [],
      },
    });
  }

  if (category === "unused_files") {
    return withSummary({
      duplicates: [],
      unused: { files: full.unused.files, dependencies: [], exports: full.unused.exports },
      orphans: [],
      slopSignals: [],
    });
  }

  if (category === "unused_dependencies") {
    return withSummary({
      duplicates: [],
      unused: { files: [], dependencies: full.unused.dependencies, exports: [] },
      orphans: [],
      slopSignals: [],
    });
  }

  if (category === "orphans") {
    return withSummary({
      duplicates: [],
      unused: { files: [], dependencies: [], exports: [] },
      orphans: full.orphans,
      slopSignals: full.slopSignals,
    });
  }

  return full;
}
