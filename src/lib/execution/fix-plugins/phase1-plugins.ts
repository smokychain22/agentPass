import type { Finding } from "@/lib/findings/types";
import { isDoNotTouchPath, isRouteLikePath } from "@/lib/findings/confidence-path-rules";

export type Phase1PluginId =
  | "remove_unused_import"
  | "remove_unused_dependency"
  | "remove_temp_file"
  | "remove_empty_file"
  | "remove_confirmed_unused_file"
  | "consolidate_exact_duplicate"
  | "review_only";

export interface Phase1FixPlugin {
  id: Phase1PluginId;
  label: string;
  description: string;
  supports(finding: Finding): boolean;
  eligibilityReason(finding: Finding): string;
}

const MIN_CONFIDENCE = 0.75;
const UNTRUSTED_SOURCE_MODES = new Set(["fallback", "heuristic"]);

const TEMP_FILE_PATTERNS = [
  /(^|\/)(archive|backup|old|tmp|temp)(\/|$)/i,
  /ButtonCopy\d*\.tsx$/i,
  /OldDashboard\.backup\./i,
  /ComponentFinal\.tsx$/i,
  /GeneratedCardCopy\./i,
  /HeroBackup\./i,
  /HeroOld\./i,
  /UnusedModal\./i,
  /UnusedCard\./i,
  /utils-copy\./i,
  /utils-old\./i,
  /temp-widget\./i,
  /\.backup\./i,
  /\.old\./i,
  /-backup\./i,
  /-old\./i,
  /-copy\./i,
  /Copy\d*\./i,
  /Final\.tsx$/i,
];

function isProtectedPath(filePath: string): boolean {
  return isDoNotTouchPath(filePath) || isRouteLikePath(filePath);
}

/** Whether a deterministic transformer may run in isolated workspace repair. */
function transformEligible(finding: Finding): boolean {
  if (finding.action === "do_not_touch" || finding.protected) return false;
  if (finding.confidence < MIN_CONFIDENCE) return false;
  if (finding.files.some(isProtectedPath)) return false;
  if (finding.source.endsWith("_fallback") || UNTRUSTED_SOURCE_MODES.has(finding.sourceMode)) {
    return false;
  }
  return hasActionablePreflight(finding) || finding.action === "safe_candidate";
}

function baseEligible(finding: Finding): boolean {
  return transformEligible(finding);
}

function hasActionablePreflight(finding: Finding): boolean {
  return finding.evidence.signals.some((s) => s === "classification=actionable_candidate");
}

function isTempFilePath(filePath: string): boolean {
  return TEMP_FILE_PATTERNS.some((p) => p.test(filePath.replace(/\\/g, "/")));
}

function hasExactDuplicateEvidence(finding: Finding): boolean {
  return finding.evidence.signals.some((s) => s === "exact_file_duplicate=true");
}

function hasEmptyFileEvidence(finding: Finding): boolean {
  return finding.evidence.signals.some((s) => s === "empty_file=true");
}

function inboundRefCount(finding: Finding): number {
  const raw = finding.evidence.signals.find((s) => s.startsWith("inbound_refs="))?.slice(13);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : -1;
}

function isKnipUnusedStructuralCandidate(finding: Finding): boolean {
  if (finding.type !== "unused_file") return false;
  if (finding.sourceMode !== "native" || finding.source !== "knip") return false;
  const file = finding.files[0];
  if (!file || isTempFilePath(file)) return false;
  return inboundRefCount(finding) === 0;
}

function isConfirmedUnusedFile(finding: Finding): boolean {
  return isKnipUnusedStructuralCandidate(finding) && hasActionablePreflight(finding);
}

/** Structural eligibility before dry-run preflight. */
export function isPhase1StructuralCandidate(finding: Finding): boolean {
  if (finding.action === "do_not_touch" || finding.protected) return false;
  if (finding.confidence < MIN_CONFIDENCE) return false;
  if (finding.files.some(isProtectedPath)) return false;
  if (finding.source.endsWith("_fallback") || UNTRUSTED_SOURCE_MODES.has(finding.sourceMode)) {
    return false;
  }
  if (finding.type === "unused_import") {
    const hasEvidence = finding.evidence.signals.some(
      (s) => s.startsWith("importLine=") || s.startsWith("symbol=")
    );
    return hasEvidence && finding.files.length === 1;
  }
  if (finding.type === "unused_dependency") {
    return Boolean(finding.packageName);
  }
  if (finding.type === "duplicate_code" && hasExactDuplicateEvidence(finding)) {
    return finding.files.length >= 2;
  }
  if (finding.type === "unused_file" || finding.type === "ai_slop_signal") {
    const file = finding.files[0];
    if (hasEmptyFileEvidence(finding) && file) return true;
    if (file && isTempFilePath(file) && finding.files.length === 1) return true;
    if (isKnipUnusedStructuralCandidate(finding)) return true;
  }
  return false;
}

export const PHASE1_PLUGINS: Phase1FixPlugin[] = [
  {
    id: "remove_unused_import",
    label: "Remove unused import",
    description: "Remove an import statement with deterministic evidence that symbols are unused.",
    supports(finding) {
      if (finding.type !== "unused_import") return false;
      if (!baseEligible(finding)) return false;
      if (finding.sourceMode === "fallback") return false;
      if (finding.source !== "knip" && finding.source !== "repodiet_import") return false;
      if (!hasActionablePreflight(finding)) return false;
      const hasEvidence = finding.evidence.signals.some(
        (s) => s.startsWith("importLine=") || s.startsWith("symbol=")
      );
      return hasEvidence && finding.files.length === 1;
    },
    eligibilityReason(finding) {
      if (finding.type !== "unused_import") return "Not an unused import finding.";
      if (finding.confidence < MIN_CONFIDENCE) return "Below confidence threshold.";
      if (finding.files.some(isProtectedPath)) return "Protected path.";
      const hasEvidence = finding.evidence.signals.some(
        (s) => s.startsWith("importLine=") || s.startsWith("symbol=")
      );
      if (!hasEvidence) return "Missing parser evidence for import removal.";
      return "Unused import with parser-verified safe removal.";
    },
  },
  {
    id: "remove_unused_dependency",
    label: "Remove unused dependency",
    description: "Remove a package absent from imports, config, and scripts with lockfile update.",
    supports(finding) {
      if (finding.type !== "unused_dependency") return false;
      if (!baseEligible(finding)) return false;
      if (finding.sourceMode !== "native" || finding.source !== "knip") return false;
      if (!finding.packageName) return false;
      return true;
    },
    eligibilityReason(finding) {
      if (finding.type !== "unused_dependency") return "Not an unused dependency finding.";
      if (finding.sourceMode !== "native") return "Requires native analyzer evidence, not fallback.";
      if (!baseEligible(finding)) return "Fails base eligibility contract.";
      return "Native knip evidence for unused package removal.";
    },
  },
  {
    id: "remove_temp_file",
    label: "Remove obvious temporary file",
    description: "Delete unreachable backup, archive, or temp files with strong path evidence.",
    supports(finding) {
      if (finding.type !== "unused_file" && finding.type !== "ai_slop_signal") return false;
      if (finding.files.length !== 1) return false;
      const file = finding.files[0];
      if (!file || !isTempFilePath(file)) return false;
      if (isProtectedPath(file)) return false;
      if (finding.confidence < MIN_CONFIDENCE) return false;
      if (finding.sourceMode === "fallback") return false;
      if (finding.type === "unused_file" && finding.source !== "knip") return false;
      if (finding.type === "ai_slop_signal") {
        return hasActionablePreflight(finding) || finding.action === "safe_candidate";
      }
      return (
        hasActionablePreflight(finding) ||
        finding.action === "safe_candidate" ||
        isTempFilePath(file)
      );
    },
    eligibilityReason(finding) {
      const file = finding.files[0];
      if (!file) return "No file path.";
      if (!isTempFilePath(file)) return "Path does not match temp/backup/archive patterns.";
      if (!baseEligible(finding)) return "Fails base eligibility contract.";
      return "Obvious temporary or backup file eligible for deletion.";
    },
  },
  {
    id: "remove_empty_file",
    label: "Remove empty file",
    description: "Delete whitespace-only source files with zero inbound references.",
    supports(finding) {
      if (finding.type !== "unused_file" && finding.type !== "ai_slop_signal") return false;
      if (!hasEmptyFileEvidence(finding)) return false;
      if (finding.files.some(isProtectedPath)) return false;
      if (finding.confidence < MIN_CONFIDENCE) return false;
      return inboundRefCount(finding) === 0;
    },
    eligibilityReason() {
      return "Empty source file with no inbound references.";
    },
  },
  {
    id: "consolidate_exact_duplicate",
    label: "Consolidate exact duplicate file",
    description: "Rewrite imports to canonical file and delete byte-identical duplicate.",
    supports(finding) {
      if (finding.type !== "duplicate_code") return false;
      if (!hasExactDuplicateEvidence(finding)) return false;
      if (!baseEligible(finding)) return false;
      if (!hasActionablePreflight(finding)) return false;
      return Boolean(signalValue(finding, "canonical=") && signalValue(finding, "duplicate="));
    },
    eligibilityReason() {
      return "Exact file duplicate with content hash evidence.";
    },
  },
  {
    id: "remove_confirmed_unused_file",
    label: "Remove confirmed unused file",
    description: "Delete Knip-confirmed unused file with zero inbound references.",
    supports(finding) {
      return isConfirmedUnusedFile(finding) && baseEligible(finding);
    },
    eligibilityReason(finding) {
      if (inboundRefCount(finding) !== 0) return "File still has inbound references.";
      if (!hasActionablePreflight(finding)) return "Preflight did not confirm safe deletion.";
      return "Native Knip unused file with zero inbound references.";
    },
  },
  {
    id: "review_only",
    label: "Review only",
    description: "Requires human review — not eligible for Phase 1 automatic fix.",
    supports: () => true,
    eligibilityReason: () => "Not eligible for automatic fix in Phase 1.",
  },
];

function signalValue(finding: Finding, prefix: string): string | undefined {
  return finding.evidence.signals.find((s) => s.startsWith(prefix))?.slice(prefix.length);
}

const PLUGIN_ORDER: Phase1PluginId[] = [
  "consolidate_exact_duplicate",
  "remove_temp_file",
  "remove_empty_file",
  "remove_confirmed_unused_file",
  "remove_unused_import",
  "remove_unused_dependency",
  "review_only",
];

export function resolvePhase1Plugin(finding: Finding): Phase1FixPlugin {
  for (const id of PLUGIN_ORDER) {
    const plugin = PHASE1_PLUGINS.find((p) => p.id === id)!;
    if (id !== "review_only" && plugin.supports(finding)) return plugin;
  }
  return PHASE1_PLUGINS.find((p) => p.id === "review_only")!;
}

/** Resolve plugin for dry-run/apply using structural evidence (preflight not required). */
export function resolvePhase1TransformPlugin(finding: Finding): Phase1FixPlugin {
  if (finding.type === "duplicate_code" && hasExactDuplicateEvidence(finding)) {
    return PHASE1_PLUGINS.find((p) => p.id === "consolidate_exact_duplicate")!;
  }
  if (hasEmptyFileEvidence(finding)) {
    return PHASE1_PLUGINS.find((p) => p.id === "remove_empty_file")!;
  }
  if (isKnipUnusedStructuralCandidate(finding)) {
    return PHASE1_PLUGINS.find((p) => p.id === "remove_confirmed_unused_file")!;
  }
  if (isPhase1StructuralCandidate(finding)) {
    if (finding.type === "unused_import") {
      return PHASE1_PLUGINS.find((p) => p.id === "remove_unused_import")!;
    }
    if (finding.type === "unused_dependency" && finding.packageName) {
      return PHASE1_PLUGINS.find((p) => p.id === "remove_unused_dependency")!;
    }
    if (
      (finding.type === "unused_file" || finding.type === "ai_slop_signal") &&
      finding.files[0] &&
      isTempFilePath(finding.files[0])
    ) {
      return PHASE1_PLUGINS.find((p) => p.id === "remove_temp_file")!;
    }
  }
  return resolvePhase1Plugin(finding);
}

export function isPhase1AutoFix(finding: Finding): boolean {
  const plugin = resolvePhase1Plugin(finding);
  return plugin.id !== "review_only";
}

export function phase1EligibilityReason(finding: Finding): string {
  const plugin = resolvePhase1Plugin(finding);
  if (plugin.id === "review_only") {
    if (finding.action === "do_not_touch") return "Protected — do not modify.";
    if (finding.type === "duplicate_code") return "Near-duplicate or non-exact duplicate requires manual review.";
    if (finding.type === "orphan_pattern") return "Orphan routes/APIs cannot be safely proven.";
    if (finding.sourceMode === "fallback") return "Fallback findings need deterministic confirmation.";
    return plugin.eligibilityReason(finding);
  }
  return plugin.eligibilityReason(finding);
}

export { isTempFilePath, isProtectedPath, MIN_CONFIDENCE as PHASE1_MIN_CONFIDENCE };
