import type { Finding } from "@/lib/findings/types";
import { isDoNotTouchPath, isRouteLikePath } from "@/lib/findings/confidence-path-rules";

export type Phase1PluginId =
  | "remove_unused_import"
  | "remove_unused_dependency"
  | "remove_temp_file"
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

function baseEligible(finding: Finding): boolean {
  if (finding.action !== "safe_candidate") return false;
  if (finding.confidence < MIN_CONFIDENCE) return false;
  if (UNTRUSTED_SOURCE_MODES.has(finding.sourceMode)) return false;
  if (finding.files.some(isProtectedPath)) return false;
  return true;
}

function isTempFilePath(filePath: string): boolean {
  return TEMP_FILE_PATTERNS.some((p) => p.test(filePath.replace(/\\/g, "/")));
}

export const PHASE1_PLUGINS: Phase1FixPlugin[] = [
  {
    id: "remove_unused_import",
    label: "Remove unused import",
    description: "Remove an import statement with deterministic evidence that symbols are unused.",
    supports(finding) {
      if (finding.type !== "unused_import") return false;
      if (finding.action !== "safe_candidate") return false;
      if (finding.confidence < MIN_CONFIDENCE) return false;
      if (UNTRUSTED_SOURCE_MODES.has(finding.sourceMode)) return false;
      if (finding.files.some(isProtectedPath)) return false;
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
      if (finding.action !== "safe_candidate") return false;
      if (finding.confidence < MIN_CONFIDENCE) return false;
      if (finding.sourceMode === "fallback") {
        return isTempFilePath(file);
      }
      if (UNTRUSTED_SOURCE_MODES.has(finding.sourceMode) && finding.type !== "ai_slop_signal") {
        return false;
      }
      return true;
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
    id: "review_only",
    label: "Review only",
    description: "Requires human review — not eligible for Phase 1 automatic fix.",
    supports: () => true,
    eligibilityReason: () => "Not eligible for automatic fix in Phase 1.",
  },
];

const PLUGIN_ORDER: Phase1PluginId[] = [
  "remove_temp_file",
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

export function isPhase1AutoFix(finding: Finding): boolean {
  const plugin = resolvePhase1Plugin(finding);
  return plugin.id !== "review_only";
}

export function phase1EligibilityReason(finding: Finding): string {
  const plugin = resolvePhase1Plugin(finding);
  if (plugin.id === "review_only") {
    if (finding.action === "do_not_touch") return "Protected — do not modify.";
    if (finding.type === "duplicate_code") return "Duplicate code requires manual review.";
    if (finding.type === "orphan_pattern") return "Orphan routes/APIs cannot be safely proven.";
    if (finding.sourceMode === "fallback") return "Fallback findings need deterministic confirmation.";
    return plugin.eligibilityReason(finding);
  }
  return plugin.eligibilityReason(finding);
}

export { isTempFilePath, isProtectedPath, MIN_CONFIDENCE as PHASE1_MIN_CONFIDENCE };
