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

/**
 * Command 3E — stable, product-facing transformation IDs and their
 * resolution semantics. A canonical ID exists only for a `Phase1PluginId`
 * that is genuinely implemented (has a real supports()/apply path) — this
 * is the single place a finding's `supportedTransformationId` is derived
 * from, so nothing can advertise a transformation RepoDiet cannot execute.
 */
export type CanonicalTransformationId =
  | "REMOVE_UNUSED_FILE"
  | "REMOVE_UNUSED_DEPENDENCY"
  | "CONSOLIDATE_DUPLICATE_IMPLEMENTATION"
  | "REMOVE_UNUSED_IMPORT";

export type ResolutionType =
  | "delete_file"
  | "remove_dependency"
  | "consolidate_duplicate"
  | "update_references"
  | "edit_code"
  | "leave_protected"
  | "report_only"
  | "unsupported";

const PHASE1_TO_CANONICAL: Partial<Record<Phase1PluginId, CanonicalTransformationId>> = {
  remove_unused_import: "REMOVE_UNUSED_IMPORT",
  remove_unused_dependency: "REMOVE_UNUSED_DEPENDENCY",
  remove_temp_file: "REMOVE_UNUSED_FILE",
  remove_empty_file: "REMOVE_UNUSED_FILE",
  remove_confirmed_unused_file: "REMOVE_UNUSED_FILE",
  consolidate_exact_duplicate: "CONSOLIDATE_DUPLICATE_IMPLEMENTATION",
};

const CANONICAL_RESOLUTION_TYPE: Record<CanonicalTransformationId, ResolutionType> = {
  REMOVE_UNUSED_FILE: "delete_file",
  REMOVE_UNUSED_DEPENDENCY: "remove_dependency",
  CONSOLIDATE_DUPLICATE_IMPLEMENTATION: "consolidate_duplicate",
  REMOVE_UNUSED_IMPORT: "edit_code",
};

const CANONICAL_ROLLBACK: Record<CanonicalTransformationId, string> = {
  REMOVE_UNUSED_FILE: "Revert the branch's file-deletion commit; original file content is preserved in git history.",
  REMOVE_UNUSED_DEPENDENCY: "Revert the package.json/lockfile commit to restore the dependency.",
  CONSOLIDATE_DUPLICATE_IMPLEMENTATION:
    "Revert the consolidation commit to restore the duplicate file and its original references.",
  REMOVE_UNUSED_IMPORT: "Revert the import-removal commit to restore the original import statement.",
};

export function canonicalTransformationId(
  pluginId: Phase1PluginId
): CanonicalTransformationId | null {
  return PHASE1_TO_CANONICAL[pluginId] ?? null;
}

export function resolutionTypeForCanonicalId(id: CanonicalTransformationId): ResolutionType {
  return CANONICAL_RESOLUTION_TYPE[id];
}

export function rollbackStrategyForCanonicalId(id: CanonicalTransformationId): string {
  return CANONICAL_ROLLBACK[id];
}

/**
 * Explicit audit of transformation IDs named in the Command 3E product
 * spec that are NOT yet implemented. Listed here — rather than silently
 * omitted — so the gap is documented and reviewable, and so no finding
 * pipeline can accidentally treat one of these as executable. Any
 * detection type that would map to one of these must resolve to
 * "unsupported"/"report_only", never "actionable".
 *
 * UPDATE_REFERENCES is listed as not-yet-standalone: reference updates are
 * only implemented today as an internal step of
 * CONSOLIDATE_DUPLICATE_IMPLEMENTATION, not as an independently selectable
 * transformation.
 */
export const NOT_YET_IMPLEMENTED_TRANSFORMATIONS = [
  "UPDATE_REFERENCES",
  "FIX_BROKEN_IMPORT",
  "FIX_TYPE_ERROR",
  "FIX_LINT_ERROR",
  "FIX_TEST_FAILURE",
  "REMOVE_STALE_SCRIPT",
  "UPDATE_CONFIGURATION",
  "UPDATE_DOCUMENTATION",
  "ADD_REGRESSION_TEST",
] as const;
