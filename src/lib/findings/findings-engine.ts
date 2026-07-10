import { nanoid } from "nanoid";
import { isDemoRepoUrl } from "@/lib/demo/constants";
import { prepareRepoWorkspace } from "@/lib/scanner/prepare-workspace";
import { runKnip } from "./run-knip";
import { runJscpd } from "./run-jscpd";
import { runMadge } from "./run-madge";
import { runAiSlopHeuristics } from "./ai-slop-heuristics";
import { normalizeFindings } from "./normalize-findings";
import type { FindingsPayload } from "./types";
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

  const empty = {
    duplicateClusters: 0,
    unusedFiles: 0,
    unusedDependencies: 0,
    unusedExports: 0,
    orphanPatterns: 0,
    slopSignals: 0,
    reviewRequired: 0,
    safeCandidates: 0,
  };

  if (category === "duplicates") {
    return {
      ...full,
      summary: { ...empty, duplicateClusters: full.duplicates.length, reviewRequired: full.duplicates.length },
      unused: { files: [], dependencies: [], exports: [] },
      orphans: [],
      slopSignals: [],
      riskBuckets: {
        safeDelete: [],
        reviewFirst: full.duplicates.map((f) => f.id),
        doNotTouch: [],
      },
    };
  }

  if (category === "unused_files") {
    const files = full.unused.files;
    return {
      ...full,
      summary: {
        ...empty,
        unusedFiles: files.length,
        unusedExports: full.unused.exports.length,
        reviewRequired: files.length + full.unused.exports.length,
      },
      duplicates: [],
      unused: { files, dependencies: [], exports: full.unused.exports },
      orphans: [],
      slopSignals: [],
    };
  }

  if (category === "unused_dependencies") {
    const deps = full.unused.dependencies;
    return {
      ...full,
      summary: {
        ...empty,
        unusedDependencies: deps.length,
        reviewRequired: deps.length,
      },
      duplicates: [],
      unused: { files: [], dependencies: deps, exports: [] },
      orphans: [],
      slopSignals: [],
    };
  }

  if (category === "orphans") {
    return {
      ...full,
      summary: {
        ...empty,
        orphanPatterns: full.orphans.length,
        slopSignals: full.slopSignals.length,
        reviewRequired: full.orphans.length + full.slopSignals.length,
      },
      duplicates: [],
      unused: { files: [], dependencies: [], exports: [] },
      orphans: full.orphans,
      slopSignals: full.slopSignals,
    };
  }

  return full;
}
