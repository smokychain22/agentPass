import type { Finding, FindingsPayload } from "./types";
import { runEvidenceGate } from "./evidence-gate";

function applyGate(finding: Finding, scanIntelligence?: FindingsPayload["scanIntelligence"]): Finding {
  const gate = runEvidenceGate(finding, scanIntelligence);
  return {
    ...finding,
    evidenceGate: gate,
    confidenceTier: gate.confidenceTier,
    priorityScore: gate.priorityScore,
  };
}

function remapFindings(
  items: Finding[],
  scanIntelligence?: FindingsPayload["scanIntelligence"]
): Finding[] {
  return items.map((f) => applyGate(f, scanIntelligence));
}

/** Apply 3-stage evidence gate, confidence tiers, and priority scoring after fusion. */
export function enrichFindingsWithEvidenceGate(payload: FindingsPayload): FindingsPayload {
  const scanIntelligence = payload.scanIntelligence;

  const enriched = {
    ...payload,
    duplicates: remapFindings(payload.duplicates, scanIntelligence),
    unused: {
      files: remapFindings(payload.unused.files, scanIntelligence),
      dependencies: remapFindings(payload.unused.dependencies, scanIntelligence),
      exports: remapFindings(payload.unused.exports, scanIntelligence),
    },
    orphans: remapFindings(payload.orphans, scanIntelligence),
    slopSignals: remapFindings(payload.slopSignals, scanIntelligence),
  };

  const flat = [
    ...enriched.duplicates,
    ...enriched.unused.files,
    ...enriched.unused.dependencies,
    ...enriched.unused.exports,
    ...enriched.orphans,
    ...enriched.slopSignals,
  ];

  const tierCounts = {
    verified: flat.filter((f) => f.confidenceTier === "verified").length,
    highConfidence: flat.filter((f) => f.confidenceTier === "high_confidence").length,
    needsReview: flat.filter((f) => f.confidenceTier === "needs_review").length,
    suppressed: flat.filter((f) => f.confidenceTier === "suppressed").length,
  };

  enriched.summary = {
    ...enriched.summary,
    confidenceTiers: tierCounts,
  };

  if (scanIntelligence && !scanIntelligence.coverage.readinessForFindings) {
    enriched.scanCoverageWarning =
      "Structure scan coverage is partial or failed — findings may include false positives. Re-scan for complete classification before trusting cleanup.";
  }

  return enriched;
}
