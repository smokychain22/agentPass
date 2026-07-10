import type { Finding, FindingsPayload } from "./types";
import { flattenFindings } from "./client";
import { enrichFindingLifecycle } from "@/lib/workflow/lifecycle";
import { isActionableFinding, countActionableFindings, countTransformerCompatible, countDryRunPassed } from "./actionability-signals";

export function enrichPayloadLifecycle(
  payload: FindingsPayload,
  context?: { generatedFindingIds?: Set<string>; validatedFindingIds?: Set<string> }
): FindingsPayload {
  const enrich = (items: Finding[]) =>
    items.map((f) => {
      const enriched = enrichFindingLifecycle(f, context);
      return {
        ...enriched,
        projectRoot: payload.repositoryModel?.primaryProjectRoot,
      };
    });

  const enriched: FindingsPayload = {
    ...payload,
    duplicates: enrich(payload.duplicates),
    unused: {
      files: enrich(payload.unused.files),
      dependencies: enrich(payload.unused.dependencies),
      exports: enrich(payload.unused.exports),
    },
    orphans: enrich(payload.orphans),
    slopSignals: enrich(payload.slopSignals),
  };

  const flat = flattenFindings(enriched);
  enriched.summary = {
    ...enriched.summary,
    transformerCompatible: countTransformerCompatible(flat),
    dryRunPassed: countDryRunPassed(flat),
    supportedFixes: countDryRunPassed(flat),
    actionableFixes: countActionableFindings(flat),
    reviewRequiredFindings: flat.filter((f) => f.action === "review_first").length,
    protectedFindings: flat.filter((f) => f.action === "do_not_touch" || f.protected).length,
  };

  return enriched;
}
