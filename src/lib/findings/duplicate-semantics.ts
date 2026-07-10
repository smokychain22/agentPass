import type { Finding } from "@/lib/findings/types";
import type { DuplicateSemantics, FileContext } from "@/lib/repository-model/types";
import { sameProjectBoundary, sameRuntimeBoundary } from "@/lib/repository-model/detect-entrypoints";

export function classifyDuplicatePair(
  a: Finding,
  b: Finding,
  ctxA?: FileContext,
  ctxB?: FileContext
): DuplicateSemantics {
  const sameProject = ctxA && ctxB ? sameProjectBoundary(ctxA, ctxB) : a.files[0]?.split("/")[0] === b.files[0]?.split("/")[0];
  const sameRuntime = ctxA && ctxB ? sameRuntimeBoundary(ctxA, ctxB) : true;

  const fileA = a.files[0] ?? "";
  const fileB = b.files[0] ?? "";
  const pathSimilarity = fileA.split("/").pop() === fileB.split("/").pop() ? 0.7 : 0.3;
  const structural = Math.min(1, (a.confidence + b.confidence) / 2);
  const behavioral = sameProject ? structural * 0.6 : structural * 0.25;

  const sideEffectDifferences =
    a.type !== b.type ||
    Boolean(a.evidence.summary !== b.evidence.summary);
  const routeDifferences =
    ctxA?.entrypointRole !== ctxB?.entrypointRole &&
    (ctxA?.protectedRoles.includes("route_component") ||
      ctxB?.protectedRoles.includes("route_component"));

  let classification: DuplicateSemantics["classification"] = "structural_clone";
  if (!sameProject) classification = "intentional_parallel";
  else if (pathSimilarity > 0.65 && structural > 0.8) classification = "exact_clone";
  else if (routeDifferences) classification = "visual_clone";

  let recommendation: DuplicateSemantics["recommendation"] = "review_first";
  let rationale = "Duplicate similarity detected within analysis boundaries.";

  if (!sameProject) {
    recommendation = "auto_fix_forbidden";
    rationale =
      "Files belong to different project roots — treated as intentional parallel implementation, not an automatic merge candidate.";
  } else if (routeDifferences || sideEffectDifferences) {
    recommendation = "review_first";
    rationale =
      "Similar structure with different route or side-effect context — review-first only.";
  } else if (classification === "exact_clone" && structural > 0.85) {
    recommendation = "review_first";
    rationale = "High structural similarity — shared-abstraction review recommended, not auto-merge.";
  }

  return {
    syntacticSimilarity: pathSimilarity,
    structuralSimilarity: structural,
    behavioralSimilarity: behavioral,
    sameProject: Boolean(sameProject),
    sameRuntime: Boolean(sameRuntime),
    sideEffectDifferences,
    routeDifferences: Boolean(routeDifferences),
    classification,
    recommendation,
    rationale,
  };
}
