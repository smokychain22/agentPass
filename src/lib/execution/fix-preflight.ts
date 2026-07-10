import fs from "node:fs/promises";
import path from "node:path";
import type { Finding } from "@/lib/findings/types";
import {
  convertSymbolToTypeOnlyImport,
  removeUnusedSymbolFromImport,
} from "@/lib/findings/unused-import-detector";
import { isDoNotTouchPath, isRouteLikePath } from "@/lib/findings/confidence-path-rules";
import { resolvePhase1Plugin, resolvePhase1TransformPlugin, type Phase1PluginId } from "./fix-plugins/phase1-plugins";
import { listStrategiesForFinding } from "./fix-strategies";
import { hashSource, countDiffStats } from "./transform-audit";

export type CandidateClassification =
  | "detected_candidate"
  | "actionable_candidate"
  | "verified_fix";

export interface FixPreflightResult {
  pluginAvailable: boolean;
  strategyAvailable: boolean;
  sourceLocated: boolean;
  sourceHashMatches: boolean;
  dryRunChangedSource: boolean;
  diffGenerated: boolean;
  protectedPathCheck: boolean;
  requiredVerificationSupported: boolean;
  classification: CandidateClassification;
  pluginId: Phase1PluginId;
  strategyId?: string;
  sourceHash?: string;
  proposedModifiedHash?: string;
  proposedDiff?: string;
  protectedPath?: boolean;
  blocker?: string;
}

export interface GeneratedChangePayload {
  originalSource: string;
  modifiedSource: string;
  originalHash: string;
  modifiedHash: string;
  unifiedDiff: string;
  changedFiles: string[];
  additions: number;
  deletions: number;
}

function importEvidence(finding: Finding): { importLine: string; symbol: string } {
  const importLine =
    finding.evidence.signals.find((s) => s.startsWith("importLine="))?.slice(11) ??
    finding.evidence.summary;
  const symbol =
    finding.evidence.signals.find((s) => s.startsWith("symbol="))?.slice(7) ?? "";
  return { importLine, symbol };
}

function dryRunUnusedImport(
  source: string,
  finding: Finding,
  strategyId: string
): string | null {
  const { importLine, symbol } = importEvidence(finding);
  if (!importLine || !symbol) return null;

  let modified: string;
  switch (strategyId) {
    case "convert_to_type_only_import":
      modified = convertSymbolToTypeOnlyImport(source, importLine, symbol);
      break;
    case "remove_entire_import_when_no_specifiers_remain_and_side_effect_free": {
      const partial = removeUnusedSymbolFromImport(source, importLine, symbol);
      if (partial === source) return null;
      modified = partial;
      break;
    }
    case "remove_unused_named_specifier":
    default:
      modified = removeUnusedSymbolFromImport(source, importLine, symbol);
      break;
  }

  return modified === source ? null : modified;
}

function buildTextDiff(relPath: string, original: string, modified: string): string {
  const origLines = original.split("\n");
  const modLines = modified.split("\n");
  const lines: string[] = [
    `diff --git a/${relPath} b/${relPath}`,
    `--- a/${relPath}`,
    `+++ b/${relPath}`,
  ];
  const max = Math.max(origLines.length, modLines.length);
  let i = 0;
  while (i < max) {
    if (origLines[i] === modLines[i]) {
      i += 1;
      continue;
    }
    const hunkStart = i;
    const origHunk: string[] = [];
    const modHunk: string[] = [];
    while (i < max && origLines[i] !== modLines[i]) {
      if (i < origLines.length) origHunk.push(`-${origLines[i]}`);
      if (i < modLines.length) modHunk.push(`+${modLines[i]}`);
      i += 1;
    }
    lines.push(`@@ -${hunkStart + 1},${origHunk.length} +${hunkStart + 1},${modHunk.length} @@`);
    lines.push(...origHunk, ...modHunk);
  }
  return lines.join("\n");
}

export async function dryRunPhase1Fix(
  rootDir: string,
  finding: Finding,
  strategyId: string
): Promise<GeneratedChangePayload | null> {
  const plugin = resolvePhase1TransformPlugin(finding);

  if (plugin.id === "remove_unused_import") {
    const rel = finding.files[0];
    if (!rel) return null;
    const full = path.join(rootDir, rel);
    const original = await fs.readFile(full, "utf8");
    const modified = dryRunUnusedImport(original, finding, strategyId);
    if (!modified) return null;
    const unifiedDiff = buildTextDiff(rel, original, modified);
    const { additions, deletions } = countDiffStats(unifiedDiff);
    if (additions + deletions === 0) return null;
    return {
      originalSource: original,
      modifiedSource: modified,
      originalHash: hashSource(original),
      modifiedHash: hashSource(modified),
      unifiedDiff,
      changedFiles: [rel],
      additions,
      deletions,
    };
  }

  if (plugin.id === "remove_temp_file") {
    if (strategyId === "archive_proposed_change") return null;
    const { generateUnifiedDeletePatch } = await import("@/lib/patch-kit/generate-unified-diff");
    const safeItems = finding.files.map((file) => ({
      path: file,
      reason: finding.reason,
      findingId: finding.id,
      findingType: finding.type,
    }));
    const originals: Record<string, string> = {};
    for (const rel of finding.files) {
      try {
        originals[rel] = await fs.readFile(path.join(rootDir, rel), "utf8");
      } catch {
        originals[rel] = "";
      }
    }
    const { patch, deletedPaths } = await generateUnifiedDeletePatch(rootDir, safeItems);
    if (!patch.trim() || deletedPaths.length === 0) return null;
    const { additions, deletions } = countDiffStats(patch);
    const rel = deletedPaths[0] ?? finding.files[0];
    return {
      originalSource: originals[rel] ?? "",
      modifiedSource: "",
      originalHash: hashSource(originals[rel] ?? ""),
      modifiedHash: hashSource(""),
      unifiedDiff: patch,
      changedFiles: deletedPaths,
      additions,
      deletions,
    };
  }

  return null;
}

export async function runFixPreflight(
  rootDir: string,
  finding: Finding,
  options?: { expectedSourceHash?: string }
): Promise<FixPreflightResult> {
  const plugin = resolvePhase1TransformPlugin(finding);
  const protectedPath = finding.files.some(
    (f) => isDoNotTouchPath(f) || isRouteLikePath(f)
  );

  const base: FixPreflightResult = {
    pluginAvailable: plugin.id !== "review_only",
    strategyAvailable: false,
    sourceLocated: false,
    sourceHashMatches: true,
    dryRunChangedSource: false,
    diffGenerated: false,
    protectedPathCheck: !protectedPath,
    requiredVerificationSupported: plugin.id !== "review_only",
    classification: "detected_candidate",
    pluginId: plugin.id,
    protectedPath,
  };

  if (protectedPath) {
    return {
      ...base,
      blocker: "Protected path — automatic fix forbidden.",
    };
  }

  if (plugin.id === "review_only") {
    return {
      ...base,
      blocker: "No supported automatic transformation.",
    };
  }

  const strategies = listStrategiesForFinding(finding, plugin.id);
  if (strategies.length === 0) {
    return {
      ...base,
      blocker: "No supported strategies for this finding.",
    };
  }

  for (const strategy of strategies) {
    try {
      if (finding.files[0]) {
        await fs.access(path.join(rootDir, finding.files[0]));
        base.sourceLocated = true;
      } else if (plugin.id === "remove_unused_dependency") {
        await fs.access(path.join(rootDir, "package.json"));
        base.sourceLocated = true;
      }

      if (options?.expectedSourceHash && finding.files[0]) {
        const source = await fs.readFile(path.join(rootDir, finding.files[0]), "utf8");
        const currentHash = hashSource(source);
        base.sourceHashMatches = currentHash === options.expectedSourceHash;
        if (!base.sourceHashMatches) {
          return {
            ...base,
            strategyAvailable: true,
            strategyId: strategy.id,
            sourceHash: currentHash,
            blocker: "Source hash mismatch — finding is stale for this workspace snapshot.",
          };
        }
      }

      const change = await dryRunPhase1Fix(rootDir, finding, strategy.id);
      if (!change) continue;

      const allPass =
        base.pluginAvailable &&
        base.sourceLocated &&
        base.sourceHashMatches &&
        base.protectedPathCheck &&
        change.originalHash !== change.modifiedHash &&
        change.unifiedDiff.length > 0 &&
        change.additions + change.deletions > 0;

      if (allPass) {
        return {
          ...base,
          strategyAvailable: true,
          strategyId: strategy.id,
          dryRunChangedSource: true,
          diffGenerated: true,
          classification: "actionable_candidate",
          sourceHash: change.originalHash,
          proposedModifiedHash: change.modifiedHash,
          proposedDiff: change.unifiedDiff,
        };
      }
    } catch {
      /* try next strategy */
    }
  }

  return {
    ...base,
    strategyAvailable: strategies.length > 0,
    blocker: "Dry-run could not produce a valid source modification.",
  };
}

export async function preflightActionableFindings(
  rootDir: string,
  findings: Finding[],
  options?: { expectedSourceHashes?: Record<string, string> }
): Promise<Map<string, FixPreflightResult>> {
  const results = new Map<string, FixPreflightResult>();
  for (const finding of findings) {
    const hash = finding.files[0]
      ? options?.expectedSourceHashes?.[finding.files[0]]
      : undefined;
    results.set(finding.id, await runFixPreflight(rootDir, finding, { expectedSourceHash: hash }));
  }
  return results;
}

export function isActionablePreflight(preflight: FixPreflightResult): boolean {
  return preflight.classification === "actionable_candidate";
}
