import type { MadgeRawReport } from "../types";
import { analyzeImportGraph } from "./import-graph";

export async function runMadgeFallback(rootDir: string): Promise<MadgeRawReport> {
  const graph = await analyzeImportGraph(rootDir);
  return {
    orphans: graph.orphans.slice(0, 80),
    circular: graph.circular.slice(0, 20),
  };
}
