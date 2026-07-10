import { nanoid } from "nanoid";
import { isDemoRepoUrl } from "@/lib/demo/constants";
import { prepareRepoWorkspace } from "@/lib/scanner/prepare-workspace";
import { runKnip } from "./run-knip";
import { runJscpd } from "./run-jscpd";
import { runMadge } from "./run-madge";
import { runAiSlopHeuristics } from "./ai-slop-heuristics";
import { normalizeFindings } from "./normalize-findings";
import { buildSummaryFromFindings } from "./stats";
import { enrichFindingsWithUnusedImports } from "./enrich-unused-imports";
import { enrichFindingsWithPreflight } from "./enrich-preflight";
import { countActionableFindings } from "./actionability-signals";
import { enrichPayloadLifecycle } from "./enrich-lifecycle";
import { applyStrictFindingsMode, isKnipAvailable } from "./strict-findings";
import {
  deduplicateCanonicalFindings,
  filterFindingsToPrimaryRoot,
  rebuildFindingsPayload,
} from "./canonical-findings";
import {
  classifyProjectRoots,
  selectPrimaryProjectRoot,
} from "@/lib/repository-model/primary-root";
import { collectMirrorPrefixes } from "@/lib/repository-model/mirror-paths";
import type { FindingsPayload, Finding } from "./types";
import type { FindingsJobStage } from "@/lib/jobs/types";

export type FindingsStageCallback = (stage: FindingsJobStage) => void;

function flattenPayloadFindings(payload: FindingsPayload): Finding[] {
  return [
    ...payload.duplicates,
    ...payload.unused.files,
    ...payload.unused.dependencies,
    ...payload.unused.exports,
    ...payload.orphans,
    ...payload.slopSignals,
  ];
}

export async function runFindingsEngine(
  repoUrl: string,
  branch?: string,
  onStage?: FindingsStageCallback,
  options?: { scanId?: string; projectRoot?: string }
): Promise<FindingsPayload> {
  onStage?.("fetching_repo");
  const workspace = await prepareRepoWorkspace(repoUrl, branch);

  try {
    onStage?.("extracting");
    onStage?.("framework_detection");
    const { buildRepositoryModel } = await import("@/lib/repository-model/project-graph");
    const repositoryModel = await buildRepositoryModel(workspace.rootDir);

    const scanId = options?.scanId ?? `scan_${nanoid(12)}`;

    onStage?.("jscpd");
    const jscpdResult = await runJscpd(workspace.rootDir);

    onStage?.("knip");
    const knipResult = await runKnip(workspace.rootDir);

    onStage?.("madge");
    const madgeResult = await runMadge(workspace.rootDir);

    onStage?.("heuristics");
    const slopSignals = await runAiSlopHeuristics(workspace.rootDir);

    onStage?.("normalizing");
    let payload = normalizeFindings({
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

    const importFindings = isKnipAvailable(payload.rawToolReports)
      ? await enrichFindingsWithUnusedImports(workspace.rootDir, flattenPayloadFindings(payload))
      : [];
    if (importFindings.length > 0) {
      payload = {
        ...payload,
        unused: {
          ...payload.unused,
          exports: [...payload.unused.exports, ...importFindings],
        },
      };
    }

    const flatBeforePreflight = flattenPayloadFindings(payload);
    const { findings: preflighted } = await enrichFindingsWithPreflight(
      workspace.rootDir,
      flatBeforePreflight
    );
    const byId = new Map(preflighted.map((f) => [f.id, f]));
    const remap = (items: Finding[]) => items.map((f) => byId.get(f.id) ?? f);
    payload = {
      ...payload,
      duplicates: remap(payload.duplicates),
      unused: {
        files: remap(payload.unused.files),
        dependencies: remap(payload.unused.dependencies),
        exports: remap(payload.unused.exports),
      },
      orphans: remap(payload.orphans),
      slopSignals: remap(payload.slopSignals),
    };

    let canonicalFlat = deduplicateCanonicalFindings(
      flattenPayloadFindings(payload),
      repositoryModel
    );
    const primaryRoot =
      options?.projectRoot ?? selectPrimaryProjectRoot(repositoryModel);
    const mirrorPrefixes = await collectMirrorPrefixes(
      repositoryModel,
      workspace.rootDir
    );
    if (mirrorPrefixes.length > 0) {
      canonicalFlat = filterFindingsToPrimaryRoot(
        canonicalFlat,
        primaryRoot,
        mirrorPrefixes
      );
    }
    payload = rebuildFindingsPayload(payload, canonicalFlat);

    payload = applyStrictFindingsMode(payload);
    payload = enrichPayloadLifecycle(payload);

    const verifiedFlat = flattenPayloadFindings(payload);
    payload.summary = {
      ...buildSummaryFromFindings(verifiedFlat),
      verifiedFindings: verifiedFlat.length,
      actionableFixes: countActionableFindings(verifiedFlat),
      detectedFindings: verifiedFlat.length,
    };

    payload.repositoryModel = {
      projects: classifyProjectRoots(repositoryModel).map((p) => ({
        packageName: p.packageName,
        projectRoot: p.relativePath || ".",
        framework: p.framework,
        runtimeTarget: p.runtimeTarget,
        workspaceMember: p.workspaceMember ?? false,
        role: p.role,
      })),
      workspaces: repositoryModel.workspaces,
      monorepoTool: repositoryModel.monorepoTool,
      primaryProjectRoot: primaryRoot || ".",
      excludedProjectRoots: mirrorPrefixes,
    };

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
