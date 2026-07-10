import type { Finding } from "@/lib/findings/types";
import type { Phase1PluginId } from "./fix-plugins/phase1-plugins";
import { MAX_STRATEGIES_PER_FINDING } from "./constants";

export interface FixStrategy {
  id: string;
  label: string;
  description: string;
  transformationType: string;
  requiredEvidence: string[];
  protectedConditions: string[];
  targetedChecks: string[];
  repositoryChecks: string[];
}

const UNUSED_IMPORT_STRATEGIES: FixStrategy[] = [
  {
    id: "remove_unused_named_specifier",
    label: "Remove unused named specifier",
    description: "Remove only the unused symbol from a named import declaration.",
    transformationType: "edit_import_specifier",
    requiredEvidence: ["symbol=", "importLine="],
    protectedConditions: ["jsx_usage", "side_effect_import", "namespace_import"],
    targetedChecks: ["parse", "import_resolution", "typecheck", "lint"],
    repositoryChecks: ["typecheck", "lint", "build"],
  },
  {
    id: "convert_to_type_only_import",
    label: "Convert to type-only import",
    description: "Convert a value import used only in type positions to import type.",
    transformationType: "convert_type_only",
    requiredEvidence: ["symbol=", "type_only_candidate"],
    protectedConditions: ["runtime_usage", "jsx_usage"],
    targetedChecks: ["parse", "typecheck"],
    repositoryChecks: ["typecheck"],
  },
  {
    id: "remove_entire_import_when_no_specifiers_remain_and_side_effect_free",
    label: "Remove entire import when safe",
    description: "Remove the full import only when no specifiers remain and side effects are ruled out.",
    transformationType: "remove_import_declaration",
    requiredEvidence: ["importLine=", "no_remaining_specifiers"],
    protectedConditions: ["side_effect_import", "re_export"],
    targetedChecks: ["parse", "import_resolution", "typecheck"],
    repositoryChecks: ["typecheck", "build"],
  },
];

const UNUSED_DEPENDENCY_STRATEGIES: FixStrategy[] = [
  {
    id: "remove_from_dependencies",
    label: "Remove from dependencies",
    description: "Remove package from dependencies and update lockfile.",
    transformationType: "manifest_edit",
    requiredEvidence: ["packageName", "native_analyzer"],
    protectedConditions: ["dynamic_import", "config_reference", "workspace_peer"],
    targetedChecks: ["manifest_validation", "lockfile_validation", "install"],
    repositoryChecks: ["typecheck", "build"],
  },
  {
    id: "remove_from_dev_dependencies",
    label: "Remove from devDependencies",
    description: "Remove package from devDependencies and update lockfile.",
    transformationType: "manifest_edit",
    requiredEvidence: ["packageName", "dev_only"],
    protectedConditions: ["script_reference", "build_plugin"],
    targetedChecks: ["manifest_validation", "lockfile_validation", "install"],
    repositoryChecks: ["typecheck", "build"],
  },
];

const TEMP_FILE_STRATEGIES: FixStrategy[] = [
  {
    id: "remove_file",
    label: "Remove file",
    description: "Delete proven unreachable temporary or backup file.",
    transformationType: "file_delete",
    requiredEvidence: ["temp_path_pattern", "no_inbound_imports"],
    protectedConditions: ["framework_entry", "route", "migration"],
    targetedChecks: ["import_graph", "route_manifest"],
    repositoryChecks: ["typecheck", "build", "test"],
  },
  {
    id: "archive_proposed_change",
    label: "Archive as proposed change",
    description: "Generate deletion diff but require review when confidence is borderline.",
    transformationType: "file_delete_review",
    requiredEvidence: ["temp_path_pattern"],
    protectedConditions: ["low_confidence"],
    targetedChecks: ["import_graph"],
    repositoryChecks: ["typecheck"],
  },
];

const STRATEGY_MAP: Partial<Record<Phase1PluginId, FixStrategy[]>> = {
  remove_unused_import: UNUSED_IMPORT_STRATEGIES,
  remove_unused_dependency: UNUSED_DEPENDENCY_STRATEGIES,
  remove_temp_file: TEMP_FILE_STRATEGIES,
};

export function listStrategiesForFinding(
  finding: Finding,
  pluginId: Phase1PluginId
): FixStrategy[] {
  const all = STRATEGY_MAP[pluginId] ?? [];
  if (pluginId === "remove_unused_import") {
    const hasTypeOnly = finding.evidence.signals.some((s) => s.includes("type_only"));
    const ordered = hasTypeOnly
      ? [...all].sort((a, b) => {
          if (a.id === "convert_to_type_only_import") return -1;
          if (b.id === "convert_to_type_only_import") return 1;
          return 0;
        })
      : all.filter((s) => s.id !== "convert_to_type_only_import");
    return ordered.slice(0, MAX_STRATEGIES_PER_FINDING);
  }
  return all.slice(0, MAX_STRATEGIES_PER_FINDING);
}

export function defaultStrategyForPlugin(pluginId: Phase1PluginId): FixStrategy | undefined {
  return STRATEGY_MAP[pluginId]?.[0];
}
