import type { FindingType } from "@/lib/findings/types";
import type { Phase1PluginId } from "./fix-plugins/phase1-plugins";

export type TransformerLifecycleState =
  | "eligible"
  | "ineligible"
  | "source_loaded"
  | "transformed"
  | "no_change"
  | "failed"
  | "diff_generated"
  | "validated"
  | "verified";

export interface TransformerDefinition {
  id: Phase1PluginId;
  label: string;
  findingTypes: FindingType[];
  description: string;
  requiredEvidence: string[];
  protectedRules: string[];
  requiredChecks: string[];
  automatic: boolean;
}

export const TRANSFORMER_REGISTRY: TransformerDefinition[] = [
  {
    id: "remove_unused_import",
    label: "Remove unused import",
    findingTypes: ["unused_import"],
    description: "AST-aware removal of unused named, default, and type-only imports.",
    requiredEvidence: ["symbol=", "importLine=", "classification=actionable_candidate"],
    protectedRules: ["protected_path", "side_effect_import", "fallback_evidence"],
    requiredChecks: ["syntax", "imports", "typecheck"],
    automatic: true,
  },
  {
    id: "remove_unused_dependency",
    label: "Remove unused dependency",
    findingTypes: ["unused_dependency"],
    description: "Remove confirmed unused package from package.json and regenerate lockfile.",
    requiredEvidence: ["native_analyzer", "packageName"],
    protectedRules: ["framework_required", "config_reference", "fallback_evidence"],
    requiredChecks: ["manifest_validation", "install", "typecheck", "build"],
    automatic: true,
  },
  {
    id: "remove_temp_file",
    label: "Remove backup/archive/temp file",
    findingTypes: ["unused_file", "ai_slop_signal"],
    description: "Delete obvious backup, archive, and temp paths with no inbound references.",
    requiredEvidence: ["temp_path_pattern", "classification=actionable_candidate"],
    protectedRules: ["route", "framework_entry", "protected_path"],
    requiredChecks: ["import_graph", "typecheck", "build"],
    automatic: true,
  },
  {
    id: "remove_empty_file",
    label: "Remove empty file",
    findingTypes: ["unused_file", "ai_slop_signal"],
    description: "Delete zero-byte or whitespace-only source files outside protected paths.",
    requiredEvidence: ["empty_file=true", "no_inbound_refs"],
    protectedRules: ["protected_path", "route", "package_export"],
    requiredChecks: ["import_graph", "typecheck"],
    automatic: true,
  },
  {
    id: "consolidate_exact_duplicate",
    label: "Consolidate exact duplicate file",
    findingTypes: ["duplicate_code"],
    description:
      "When two files have identical content, keep canonical path, rewrite imports, delete duplicate.",
    requiredEvidence: ["exact_file_duplicate=true", "content_hash=", "canonical=", "duplicate="],
    protectedRules: ["near_duplicate", "route_difference", "protected_path"],
    requiredChecks: ["import_resolution", "typecheck", "build"],
    automatic: true,
  },
  {
    id: "remove_confirmed_unused_file",
    label: "Remove confirmed unused file",
    findingTypes: ["unused_file"],
    description:
      "Delete Knip-confirmed unused files with zero inbound references and successful verification.",
    requiredEvidence: ["native_analyzer", "inbound_refs=0", "classification=actionable_candidate"],
    protectedRules: ["temp_path", "protected_path", "dynamic_import", "fallback_evidence"],
    requiredChecks: ["import_graph", "typecheck", "lint", "build"],
    automatic: true,
  },
  {
    id: "review_only",
    label: "Review only",
    findingTypes: [
      "duplicate_code",
      "orphan_pattern",
      "unused_export",
      "unused_file",
      "ai_slop_signal",
    ],
    description: "Human review required — no deterministic automatic transformation.",
    requiredEvidence: [],
    protectedRules: ["insufficient_evidence"],
    requiredChecks: [],
    automatic: false,
  },
];

export function getTransformerDefinition(id: Phase1PluginId): TransformerDefinition | undefined {
  return TRANSFORMER_REGISTRY.find((t) => t.id === id);
}

export function listAutomaticTransformers(): TransformerDefinition[] {
  return TRANSFORMER_REGISTRY.filter((t) => t.automatic);
}

export function isSuccessfulTransformState(state: TransformerLifecycleState): boolean {
  return state === "diff_generated" || state === "validated" || state === "verified";
}
