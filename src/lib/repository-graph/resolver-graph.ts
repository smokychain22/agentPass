import { analyzeImportGraph, type ImportGraphAnalysis } from "@/lib/findings/fallback/import-graph";
import type { MadgeRawReport } from "@/lib/findings/types";

export interface CycleVerificationResult {
  resolverCycles: string[][];
  madgeCycles: string[][];
  madgeOnlyCycles: string[][];
  resolverOnlyCycles: string[][];
  agreementRatio: number;
}

function cycleKey(cycle: string[]): string {
  return [...cycle].sort().join("→");
}

function normalizeMadgeCycles(madge: MadgeRawReport | null): string[][] {
  if (!madge?.circular?.length) return [];
  return madge.circular.map((c) =>
    (Array.isArray(c) ? c : [String(c)]).map((p) => p.replace(/\\/g, "/"))
  );
}

export async function buildResolverGraph(rootDir: string): Promise<ImportGraphAnalysis> {
  return analyzeImportGraph(rootDir);
}

/** Independent SCC cycle verification — Madge is evidence, not ground truth. */
export async function verifyCyclesIndependent(
  rootDir: string,
  madgeReport: MadgeRawReport | null
): Promise<CycleVerificationResult> {
  const graph = await buildResolverGraph(rootDir);
  const resolverCycles = graph.circular;
  const madgeCycles = normalizeMadgeCycles(madgeReport);

  const resolverKeys = new Set(resolverCycles.map(cycleKey));
  const madgeKeys = new Set(madgeCycles.map(cycleKey));

  const madgeOnlyCycles = madgeCycles.filter((c) => !resolverKeys.has(cycleKey(c)));
  const resolverOnlyCycles = resolverCycles.filter((c) => !madgeKeys.has(cycleKey(c)));

  const union = new Set([...resolverKeys, ...madgeKeys]);
  const intersection = [...resolverKeys].filter((k) => madgeKeys.has(k)).length;
  const agreementRatio = union.size === 0 ? 1 : intersection / union.size;

  return {
    resolverCycles,
    madgeCycles,
    madgeOnlyCycles,
    resolverOnlyCycles,
    agreementRatio,
  };
}
