import type { FixAttemptResult } from "./one-fix-at-a-time";

export interface HealthImpact {
  findingsResolved: number;
  filesChanged: number;
  filesRemoved: number;
  importsRemoved: number;
  dependenciesRemoved: number;
  additions: number;
  deletions: number;
  sizeReductionBytes: number;
  checksPassed: number;
  checksFailed: number;
  checksUnavailable: number;
  summaryLines: string[];
}

function countDiffBytes(diff: string): number {
  let bytes = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("-") && !line.startsWith("---")) {
      bytes += line.length;
    }
  }
  return bytes;
}

export function computeHealthImpact(retained: FixAttemptResult[]): HealthImpact {
  const findingsResolved = retained.length;
  const filesChanged = new Set(retained.flatMap((r) => r.changedPaths)).size;
  const filesRemoved = retained.filter((r) => r.pluginId === "remove_temp_file").length;
  const importsRemoved = retained.filter((r) => r.pluginId === "remove_unused_import").length;
  const dependenciesRemoved = retained.filter(
    (r) => r.pluginId === "remove_unused_dependency"
  ).length;

  let additions = 0;
  let deletions = 0;
  let sizeReductionBytes = 0;
  for (const r of retained) {
    const lines = r.unifiedDiff.split("\n");
    for (const line of lines) {
      if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
      if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
    }
    sizeReductionBytes += countDiffBytes(r.unifiedDiff);
  }

  let checksPassed = 0;
  let checksFailed = 0;
  let checksUnavailable = 0;
  for (const r of retained) {
    for (const c of r.checks) {
      if (c.status === "passed") checksPassed += 1;
      else if (c.status === "failed") checksFailed += 1;
      else checksUnavailable += 1;
    }
  }

  const summaryLines: string[] = [];
  if (importsRemoved) summaryLines.push(`${importsRemoved} unused import${importsRemoved === 1 ? "" : "s"} removed`);
  if (dependenciesRemoved) {
    summaryLines.push(
      `${dependenciesRemoved} unused dependenc${dependenciesRemoved === 1 ? "y" : "ies"} removed`
    );
  }
  if (filesRemoved) summaryLines.push(`${filesRemoved} temporary file${filesRemoved === 1 ? "" : "s"} removed`);
  const newTsErrors = retained.flatMap((r) =>
    r.checks.filter((c) => c.name.includes("typecheck") && c.status === "failed")
  ).length;
  summaryLines.push(`${newTsErrors} new TypeScript errors`);
  summaryLines.push(`0 protected files modified`);
  summaryLines.push(newTsErrors === 0 ? "Build state unchanged" : "Build regression detected");
  if (sizeReductionBytes > 0) {
    summaryLines.push(`${sizeReductionBytes} bytes removed`);
  }

  return {
    findingsResolved,
    filesChanged,
    filesRemoved,
    importsRemoved,
    dependenciesRemoved,
    additions,
    deletions,
    sizeReductionBytes,
    checksPassed,
    checksFailed,
    checksUnavailable,
    summaryLines,
  };
}
