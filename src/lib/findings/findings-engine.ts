import { nanoid } from "nanoid";
import { prepareRepoWorkspace } from "@/lib/scanner/prepare-workspace";
import { runKnip } from "./run-knip";
import { runJscpd } from "./run-jscpd";
import { runMadge } from "./run-madge";
import { runAiSlopHeuristics } from "./ai-slop-heuristics";
import { normalizeFindings } from "./normalize-findings";
import type { FindingsPayload } from "./types";

export async function runFindingsEngine(
  repoUrl: string,
  branch?: string
): Promise<FindingsPayload> {
  const workspace = await prepareRepoWorkspace(repoUrl, branch);

  try {
    const scanId = `scan_${nanoid(12)}`;

    const [knipResult, jscpdResult, madgeResult, slopSignals] = await Promise.all([
      runKnip(workspace.rootDir),
      runJscpd(workspace.rootDir),
      runMadge(workspace.rootDir),
      runAiSlopHeuristics(workspace.rootDir),
    ]);

    return normalizeFindings({
      scanId,
      repo: workspace.repo,
      rootDir: workspace.rootDir,
      knip: knipResult.report,
      knipAvailable: knipResult.available,
      jscpd: jscpdResult.report,
      jscpdAvailable: jscpdResult.available,
      madge: madgeResult.report,
      madgeAvailable: madgeResult.available,
      slop: slopSignals,
    });
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
