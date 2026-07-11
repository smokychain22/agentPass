import fs from "node:fs/promises";
import path from "node:path";
import type { Finding } from "@/lib/findings/types";
import {
  convertSymbolToTypeOnlyImport,
  removeUnusedSymbolFromImport,
  removeUnusedSymbolAtLine,
} from "@/lib/findings/unused-import-detector";
import { isDoNotTouchPath, isRouteLikePath } from "@/lib/findings/confidence-path-rules";
import { resolvePhase1Plugin, resolvePhase1TransformPlugin, type Phase1PluginId } from "./fix-plugins/phase1-plugins";
import { listStrategiesForFinding } from "./fix-strategies";
import { blockerCodeFromPreflight } from "./candidate-lifecycle";
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
  blockerCode?: import("./candidate-lifecycle").BlockerCode;
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

export type DependencySection =
  | "dependencies"
  | "devDependencies"
  | "optionalDependencies"
  | "peerDependencies";

export interface DependencyPreflightEvidence {
  packageName: string;
  manifestPath: string;
  dependencySection: DependencySection;
  analyzerEvidence: string;
}

const DEPENDENCY_SECTIONS: DependencySection[] = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

export async function resolveDependencyEntry(
  rootDir: string,
  finding: Finding
): Promise<DependencyPreflightEvidence | { eligible: false; reason: string }> {
  const packageName = finding.packageName?.trim();
  if (!packageName) {
    return { eligible: false, reason: "Dependency entry was not found in the selected manifest." };
  }

  const manifestPath = finding.manifestPath?.replace(/\\/g, "/") ?? "package.json";
  const fullManifest = path.join(rootDir, manifestPath);
  let pkg: Record<string, Record<string, string> | undefined>;
  try {
    pkg = JSON.parse(await fs.readFile(fullManifest, "utf8")) as Record<
      string,
      Record<string, string> | undefined
    >;
  } catch {
    return { eligible: false, reason: "Dependency entry was not found in the selected manifest." };
  }

  let dependencySection = finding.dependencySection;
  if (!dependencySection) {
    for (const section of DEPENDENCY_SECTIONS) {
      if (pkg[section]?.[packageName] !== undefined) {
        dependencySection = section;
        break;
      }
    }
  }

  if (!dependencySection || pkg[dependencySection]?.[packageName] === undefined) {
    return { eligible: false, reason: "Dependency entry was not found in the selected manifest." };
  }

  const lockfiles = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb"];
  const hasLockfile = await Promise.all(
    lockfiles.map((name) => fs.access(path.join(rootDir, name)).then(() => true).catch(() => false))
  ).then((results) => results.some(Boolean));

  if (!hasLockfile && manifestPath === "package.json") {
    try {
      await fs.access(path.join(rootDir, "package.json"));
    } catch {
      return { eligible: false, reason: "Dependency entry was not found in the selected manifest." };
    }
  }

  const analyzerEvidence =
    finding.analyzerEvidence ??
    finding.evidence.summary ??
    finding.evidence.signals.find((s) => s.startsWith("knip=")) ??
    finding.source;

  return {
    packageName,
    manifestPath,
    dependencySection,
    analyzerEvidence,
  };
}

function importEvidence(finding: Finding): { importLine: string; symbol: string; lineNumber?: number } {
  const importLine =
    finding.evidence.signals.find((s) => s.startsWith("importLine="))?.slice("importLine=".length) ??
    finding.evidence.summary;
  const symbol =
    finding.evidence.signals.find((s) => s.startsWith("symbol="))?.slice("symbol=".length) ?? "";
  const lineRaw = finding.evidence.signals.find((s) => s.startsWith("line="))?.slice("line=".length);
  const lineNumber = lineRaw ? Number(lineRaw) : undefined;
  return { importLine, symbol, lineNumber: Number.isFinite(lineNumber) ? lineNumber : undefined };
}

function dryRunUnusedImport(
  source: string,
  finding: Finding,
  strategyId: string
): string | null {
  const { importLine, symbol, lineNumber } = importEvidence(finding);
  if (!symbol) return null;

  let modified: string | null = null;
  switch (strategyId) {
    case "convert_to_type_only_import":
      modified = convertSymbolToTypeOnlyImport(source, importLine, symbol);
      break;
    case "remove_entire_import_when_no_specifiers_remain_and_side_effect_free": {
      const partial = removeUnusedSymbolFromImport(source, importLine, symbol);
      modified = partial === source ? null : partial;
      break;
    }
    case "remove_unused_named_specifier":
    default:
      modified = removeUnusedSymbolFromImport(source, importLine, symbol);
      if (modified === source && lineNumber) {
        modified = removeUnusedSymbolAtLine(source, lineNumber, symbol);
      }
      break;
  }

  return modified === source ? null : modified;
}

export function buildTextDiff(relPath: string, original: string, modified: string): string {
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

async function dryRunDeleteFile(
  rootDir: string,
  finding: Finding
): Promise<GeneratedChangePayload | null> {
  const { previewUnifiedDeletePatch } = await import("@/lib/patch-kit/generate-unified-diff");
  const rel = finding.files[0];
  if (!rel) return null;
  const safeItems = finding.files.map((file) => ({
    path: file,
    reason: finding.reason,
    findingId: finding.id,
    findingType: finding.type,
  }));
  const originals: Record<string, string> = {};
  for (const file of finding.files) {
    try {
      originals[file] = await fs.readFile(path.join(rootDir, file), "utf8");
    } catch {
      originals[file] = "";
    }
  }
  const scratch = path.join(rootDir, ".repodiet-scratch");
  await fs.mkdir(scratch, { recursive: true });
  const { patch, deletedPaths } = await previewUnifiedDeletePatch(rootDir, safeItems, scratch);
  if (!patch.trim() || deletedPaths.length === 0) return null;
  const { additions, deletions } = countDiffStats(patch);
  const deleted = deletedPaths[0] ?? rel;
  return {
    originalSource: originals[deleted] ?? "",
    modifiedSource: "",
    originalHash: hashSource(originals[deleted] ?? ""),
    modifiedHash: hashSource(""),
    unifiedDiff: patch,
    changedFiles: deletedPaths,
    additions,
    deletions,
  };
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
    return dryRunDeleteFile(rootDir, finding);
  }

  if (
    plugin.id === "remove_empty_file" ||
    plugin.id === "remove_confirmed_unused_file"
  ) {
    return dryRunDeleteFile(rootDir, finding);
  }

  if (plugin.id === "consolidate_exact_duplicate") {
    const canonical = finding.evidence.signals.find((s) => s.startsWith("canonical="))?.slice(10);
    const duplicate = finding.evidence.signals.find((s) => s.startsWith("duplicate="))?.slice(10);
    if (!canonical || !duplicate) return null;
    const original = await fs.readFile(path.join(rootDir, duplicate), "utf8");
    const unifiedDiff = buildTextDiff(duplicate, original, "");
    const { additions, deletions } = countDiffStats(unifiedDiff);
    if (additions + deletions === 0) return null;
    return {
      originalSource: original,
      modifiedSource: "",
      originalHash: hashSource(original),
      modifiedHash: hashSource(""),
      unifiedDiff,
      changedFiles: [duplicate],
      additions,
      deletions,
    };
  }

  if (plugin.id === "remove_unused_dependency") {
    const dep = await resolveDependencyEntry(rootDir, finding);
    if ("eligible" in dep && dep.eligible === false) return null;
    const evidence = dep as DependencyPreflightEvidence;
    const pkgName = evidence.packageName;
    const pkgPath = path.join(rootDir, evidence.manifestPath);
    const original = await fs.readFile(pkgPath, "utf8");
    const pkg = JSON.parse(original) as Record<string, Record<string, string> | undefined>;
    const modifiedPkg = structuredClone(pkg) as Record<string, Record<string, string> | undefined>;
    const section = evidence.dependencySection;
    if (!modifiedPkg[section]?.[pkgName]) return null;
    delete modifiedPkg[section]![pkgName];
    const modified = `${JSON.stringify(modifiedPkg, null, 2)}\n`;
    const relManifest = evidence.manifestPath.replace(/\\/g, "/");
    const unifiedDiff = buildTextDiff(relManifest, original, modified);
    const { additions, deletions } = countDiffStats(unifiedDiff);
    if (additions + deletions === 0) return null;
    return {
      originalSource: original,
      modifiedSource: modified,
      originalHash: hashSource(original),
      modifiedHash: hashSource(modified),
      unifiedDiff,
      changedFiles: [relManifest],
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
    const blocker = "Protected path — automatic fix forbidden.";
    return {
      ...base,
      blocker,
      blockerCode: blockerCodeFromPreflight({ ...base, blocker, classification: "detected_candidate" }),
    };
  }

  if (plugin.id === "review_only") {
    const blocker = "No supported automatic transformation.";
    return {
      ...base,
      blocker,
      blockerCode: "plugin_not_implemented",
    };
  }

  if (plugin.id === "remove_unused_dependency") {
    const resolved = await resolveDependencyEntry(rootDir, finding);
    if ("eligible" in resolved && resolved.eligible === false) {
      const blocker = resolved.reason;
      return {
        ...base,
        strategyAvailable: false,
        blocker,
        blockerCode: "transform_noop",
      };
    }
    const dep = resolved as DependencyPreflightEvidence;
    const strategies = listStrategiesForFinding(finding, plugin.id);
    if (strategies.length === 0) {
      const blocker = "No supported strategies for this finding.";
      return {
        ...base,
        blocker,
        blockerCode: "plugin_strategy_missing",
      };
    }
    for (const strategy of strategies) {
      try {
        await fs.access(path.join(rootDir, dep.manifestPath));
        base.sourceLocated = true;
        const change = await dryRunPhase1Fix(rootDir, {
          ...finding,
          packageName: dep.packageName,
          manifestPath: dep.manifestPath,
          dependencySection: dep.dependencySection,
          analyzerEvidence: dep.analyzerEvidence,
        }, strategy.id);
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
    const blocker = "Dry-run could not produce a valid source modification.";
    return {
      ...base,
      strategyAvailable: strategies.length > 0,
      blocker,
      blockerCode: blockerCodeFromPreflight({
        ...base,
        strategyAvailable: strategies.length > 0,
        blocker,
        classification: "detected_candidate",
      }),
    };
  }

  const strategies = listStrategiesForFinding(finding, plugin.id);
  if (strategies.length === 0) {
    const blocker = "No supported strategies for this finding.";
    return {
      ...base,
      blocker,
      blockerCode: "plugin_strategy_missing",
    };
  }

  for (const strategy of strategies) {
    try {
      if (finding.files[0]) {
        await fs.access(path.join(rootDir, finding.files[0]));
        base.sourceLocated = true;
      }

      if (options?.expectedSourceHash && finding.files[0]) {
        const source = await fs.readFile(path.join(rootDir, finding.files[0]), "utf8");
        const currentHash = hashSource(source);
        base.sourceHashMatches = currentHash === options.expectedSourceHash;
        if (!base.sourceHashMatches) {
          const blocker = "Source hash mismatch — finding is stale for this workspace snapshot.";
          return {
            ...base,
            strategyAvailable: true,
            strategyId: strategy.id,
            sourceHash: currentHash,
            blocker,
            blockerCode: "source_hash_mismatch",
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

  const blocker = "Dry-run could not produce a valid source modification.";
  return {
    ...base,
    strategyAvailable: strategies.length > 0,
    blocker,
    blockerCode: blockerCodeFromPreflight({
      ...base,
      strategyAvailable: strategies.length > 0,
      blocker,
      classification: "detected_candidate",
    }),
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
