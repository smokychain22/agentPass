import type { ImportGraphAnalysis } from "@/lib/findings/fallback/import-graph";
import { buildResolverGraph } from "@/lib/repository-graph/resolver-graph";

export interface ImportGraphDiff {
  beforeEdgeCount: number;
  afterEdgeCount: number;
  addedEdges: Array<{ from: string; to: string }>;
  removedEdges: Array<{ from: string; to: string }>;
  beforeCycleCount: number;
  afterCycleCount: number;
  newCycles: string[][];
  resolvedCycles: string[][];
}

function edgeList(graph: ImportGraphAnalysis): Array<{ from: string; to: string }> {
  const edges: Array<{ from: string; to: string }> = [];
  for (const [from, targets] of graph.imports) {
    for (const to of targets) {
      edges.push({ from, to });
    }
  }
  return edges;
}

function cycleKey(cycle: string[]): string {
  return [...cycle].sort().join("→");
}

export async function diffImportGraphs(
  baselineRoot: string,
  patchedRoot: string
): Promise<ImportGraphDiff> {
  const before = await buildResolverGraph(baselineRoot);
  const after = await buildResolverGraph(patchedRoot);

  const beforeEdges = edgeList(before);
  const afterEdges = edgeList(after);
  const beforeSet = new Set(beforeEdges.map((e) => `${e.from}→${e.to}`));
  const afterSet = new Set(afterEdges.map((e) => `${e.from}→${e.to}`));

  const addedEdges = afterEdges.filter((e) => !beforeSet.has(`${e.from}→${e.to}`));
  const removedEdges = beforeEdges.filter((e) => !afterSet.has(`${e.from}→${e.to}`));

  const beforeCycleKeys = new Set(before.circular.map(cycleKey));
  const afterCycleKeys = new Set(after.circular.map(cycleKey));

  return {
    beforeEdgeCount: beforeEdges.length,
    afterEdgeCount: afterEdges.length,
    addedEdges: addedEdges.slice(0, 50),
    removedEdges: removedEdges.slice(0, 50),
    beforeCycleCount: before.circular.length,
    afterCycleCount: after.circular.length,
    newCycles: after.circular.filter((c) => !beforeCycleKeys.has(cycleKey(c))).slice(0, 10),
    resolvedCycles: before.circular.filter((c) => !afterCycleKeys.has(cycleKey(c))).slice(0, 10),
  };
}
