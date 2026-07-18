/**
 * Mandatory fallback chain: semantic → structural → textual → metadata.
 * A failed semantic attempt never removes a path from accounting.
 */
import type { AnalyzerLayer, AnalyzerAttempt, CoverageInventoryEntry } from "./types";
import type { TerminalCoverageOutcome } from "./outcomes";
import { ANALYZER_REGISTRY, type AnalyzerId } from "./analyzer-registry";

export const FALLBACK_LAYER_ORDER: AnalyzerLayer[] = [
  "semantic",
  "structural",
  "textual",
  "metadata",
];

export function nextFallbackLayer(current: AnalyzerLayer): AnalyzerLayer | null {
  const idx = FALLBACK_LAYER_ORDER.indexOf(current);
  if (idx < 0 || idx >= FALLBACK_LAYER_ORDER.length - 1) return null;
  return FALLBACK_LAYER_ORDER[idx + 1]!;
}

export function layersFromPlan(entry: CoverageInventoryEntry): AnalyzerLayer[] {
  const primary = entry.analyzerPlan.primaryLayer;
  const extras = entry.analyzerPlan.fallbackLayers ?? [];
  const ordered = [primary, ...extras, ...FALLBACK_LAYER_ORDER.filter((l) => l !== primary)];
  const seen = new Set<AnalyzerLayer>();
  const out: AnalyzerLayer[] = [];
  for (const layer of ordered) {
    if (seen.has(layer)) continue;
    seen.add(layer);
    out.push(layer);
  }
  return out;
}

/** Map a successful analyzer layer to a terminal coverage outcome. */
export function outcomeForSuccessfulLayer(
  layer: AnalyzerLayer,
  entry: CoverageInventoryEntry
): TerminalCoverageOutcome {
  if (entry.finalCoverageOutcome === "GENERATED_CLASSIFIED") return "GENERATED_CLASSIFIED";
  if (entry.finalCoverageOutcome === "VENDORED_CLASSIFIED") return "VENDORED_CLASSIFIED";
  if (entry.finalCoverageOutcome === "PROTECTED_BY_POLICY") return "PROTECTED_BY_POLICY";
  if (entry.submodule) return "METADATA_ANALYZED";
  if (entry.symlink) return "METADATA_ANALYZED";
  if (entry.materializationStatus === "LFS_POINTER") return "METADATA_ANALYZED";
  if (entry.materializationStatus === "NOT_MATERIALIZED") return "UNREADABLE_WITH_REASON";
  if (entry.materializationStatus === "MATERIALIZATION_FAILED_WITH_REASON") {
    return "UNREADABLE_WITH_REASON";
  }

  switch (layer) {
    case "semantic":
      return "SEMANTICALLY_ANALYZED";
    case "structural":
      return "STRUCTURALLY_ANALYZED";
    case "textual":
      return "TEXTUALLY_ANALYZED";
    case "metadata":
      return entry.matchingRule?.includes("binary") || entry.byteSize > 0
        ? entry.matchingRule === "binary_extension" || entry.matchingRule === "binary_ext"
          ? "BINARY_INSPECTED"
          : "METADATA_ANALYZED"
        : "METADATA_ANALYZED";
    default:
      return "METADATA_ANALYZED";
  }
}

export function makeAttempt(input: {
  pathExact: string;
  analyzerId: AnalyzerId;
  layer: AnalyzerLayer;
  status: AnalyzerAttempt["status"];
  reason?: string;
  owner?: string;
  repository?: string;
  pinnedCommitSha?: string;
  reducesCleanupConfidence?: boolean;
}): AnalyzerAttempt {
  const descriptor = ANALYZER_REGISTRY[input.analyzerId];
  const now = new Date().toISOString();
  return {
    pathExact: input.pathExact,
    layer: input.layer,
    status: input.status,
    reason: input.reason,
    startedAt: now,
    finishedAt: now,
    owner: input.owner,
    repository: input.repository,
    pinnedCommitSha: input.pinnedCommitSha,
    // Extended fields carried in reason-safe shape for Phase 1 persistence.
    ...(descriptor
      ? {
          reason: input.reason
            ? `${input.reason} [analyzer=${descriptor.id}@${descriptor.version}]`
            : `analyzer=${descriptor.id}@${descriptor.version}`,
        }
      : {}),
  };
}

/**
 * Apply the fallback chain to inventory entries that still need analysis.
 * Policy-classified / already-terminal paths keep their outcomes.
 * Never promotes cleanup eligibility.
 */
export function applyFallbackChainToInventory(
  inventory: CoverageInventoryEntry[],
  options?: {
    jsTsSemanticSucceeded?: boolean;
    owner?: string;
    repository?: string;
    pinnedCommitSha?: string;
  }
): { inventory: CoverageInventoryEntry[]; attempts: AnalyzerAttempt[] } {
  const attempts: AnalyzerAttempt[] = [];
  const jsTsOk = options?.jsTsSemanticSucceeded ?? false;

  const next = inventory.map((entry) => {
    // Keep explicit policy / materialization terminals.
    if (
      entry.finalCoverageOutcome === "GENERATED_CLASSIFIED" ||
      entry.finalCoverageOutcome === "VENDORED_CLASSIFIED" ||
      entry.finalCoverageOutcome === "PROTECTED_BY_POLICY" ||
      entry.finalCoverageOutcome === "UNREADABLE_WITH_REASON" ||
      entry.finalCoverageOutcome === "BINARY_INSPECTED" ||
      entry.submodule ||
      entry.symlink ||
      entry.materializationStatus === "LFS_POINTER" ||
      entry.materializationStatus === "SUBMODULE_GITLINK" ||
      entry.materializationStatus === "SYMLINK_REPRESENTED"
    ) {
      if (entry.submodule || entry.materializationStatus === "SUBMODULE_GITLINK") {
        return { ...entry, finalCoverageOutcome: "METADATA_ANALYZED" as const };
      }
      if (entry.symlink || entry.materializationStatus === "SYMLINK_REPRESENTED") {
        return { ...entry, finalCoverageOutcome: "METADATA_ANALYZED" as const };
      }
      if (entry.materializationStatus === "LFS_POINTER") {
        return { ...entry, finalCoverageOutcome: "METADATA_ANALYZED" as const };
      }
      return entry;
    }

    const layers = layersFromPlan(entry);
    let assigned: TerminalCoverageOutcome | null = null;

    for (const layer of layers) {
      if (layer === "semantic") {
        const isJsTs = /\.(tsx?|jsx?|mjs|cjs|mts|cts)$/i.test(entry.pathExact);
        if (isJsTs && jsTsOk && entry.materializationStatus === "MATERIALIZED") {
          attempts.push(
            makeAttempt({
              pathExact: entry.pathExact,
              analyzerId: "knip",
              layer: "semantic",
              status: "SUCCESS",
              reason: "Covered by JS/TS semantic analyzer suite for this scan.",
              owner: options?.owner,
              repository: options?.repository,
              pinnedCommitSha: options?.pinnedCommitSha,
            })
          );
          assigned = "SEMANTICALLY_ANALYZED";
          break;
        }
        attempts.push(
          makeAttempt({
            pathExact: entry.pathExact,
            analyzerId: isJsTs ? "knip" : "metadata_fallback",
            layer: "semantic",
            status: isJsTs ? "FAILED" : "NOT_APPLICABLE",
            reason: isJsTs
              ? "JS/TS semantic suite unavailable or failed for this path; falling back."
              : "No Phase 1 semantic analyzer for this language/format.",
            owner: options?.owner,
            repository: options?.repository,
            pinnedCommitSha: options?.pinnedCommitSha,
            reducesCleanupConfidence: true,
          })
        );
        continue;
      }

      if (layer === "structural") {
        const isJson = /\.jsonc?$/i.test(entry.pathExact);
        if (isJson && entry.materializationStatus === "MATERIALIZED") {
          attempts.push(
            makeAttempt({
              pathExact: entry.pathExact,
              analyzerId: "structural_json",
              layer: "structural",
              status: "SUCCESS",
              reason: "JSON/JSONC structural parse path.",
              owner: options?.owner,
              repository: options?.repository,
              pinnedCommitSha: options?.pinnedCommitSha,
            })
          );
          assigned = "STRUCTURALLY_ANALYZED";
          break;
        }
        attempts.push(
          makeAttempt({
            pathExact: entry.pathExact,
            analyzerId: "structural_json",
            layer: "structural",
            status: "NOT_APPLICABLE",
            reason: "No structural parser for this format in Phase 1.",
            owner: options?.owner,
            repository: options?.repository,
            pinnedCommitSha: options?.pinnedCommitSha,
          })
        );
        continue;
      }

      if (layer === "textual") {
        if (entry.materializationStatus === "MATERIALIZED" && entry.contentInspected !== false) {
          attempts.push(
            makeAttempt({
              pathExact: entry.pathExact,
              analyzerId: "textual_fallback",
              layer: "textual",
              status: "SUCCESS",
              reason: "Textual fallback inspection recorded.",
              owner: options?.owner,
              repository: options?.repository,
              pinnedCommitSha: options?.pinnedCommitSha,
            })
          );
          assigned = "TEXTUALLY_ANALYZED";
          break;
        }
        attempts.push(
          makeAttempt({
            pathExact: entry.pathExact,
            analyzerId: "textual_fallback",
            layer: "textual",
            status: "INPUT_UNAVAILABLE",
            reason: "Text content unavailable; continuing to metadata.",
            owner: options?.owner,
            repository: options?.repository,
            pinnedCommitSha: options?.pinnedCommitSha,
          })
        );
        continue;
      }

      // metadata — always succeeds for accounting
      const binaryRule =
        entry.matchingRule === "binary_extension" ||
        entry.matchingRule === "binary_ext" ||
        entry.matchingRule === "binary_ext_rule";
      attempts.push(
        makeAttempt({
          pathExact: entry.pathExact,
          analyzerId: binaryRule ? "binary_inspector" : "metadata_fallback",
          layer: "metadata",
          status: "SUCCESS",
          reason: binaryRule
            ? "Binary/metadata inspection from git tree + path classification."
            : "Metadata-only coverage from pinned git tree.",
          owner: options?.owner,
          repository: options?.repository,
          pinnedCommitSha: options?.pinnedCommitSha,
        })
      );
      assigned = binaryRule ? "BINARY_INSPECTED" : "METADATA_ANALYZED";
      break;
    }

    return {
      ...entry,
      finalCoverageOutcome: assigned ?? ("METADATA_ANALYZED" as const),
    };
  });

  return { inventory: next, attempts };
}
