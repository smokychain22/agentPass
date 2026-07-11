import type { KnipRawReport } from "../types";
import { analyzeImportGraph } from "./import-graph";

export async function runKnipFallback(rootDir: string): Promise<KnipRawReport> {
  const graph = await analyzeImportGraph(rootDir);

  const issues: KnipRawReport["issues"] = [];

  for (const file of graph.unusedFiles) {
    issues.push({
      file,
      files: [{ name: file }],
      dependencies: [],
      devDependencies: [],
      exports: [],
    });
  }

  if (graph.unusedDependencies.length > 0) {
    issues.push({
      file: "package.json",
      files: [],
      dependencies: graph.unusedDependencies.map((name) => ({ name })),
      devDependencies: [],
      exports: [],
    });
  }

  return { issues };
}
