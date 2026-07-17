/**
 * Canonical transform contract for production cleanup.
 * Every automatic transform must implement supports/plan/apply/validate/rollback.
 */

export type TransformSafetyClass = "SAFE" | "REVIEW_FIRST" | "PROTECTED";

export interface TransformContract {
  id: string;
  label: string;
  safety: TransformSafetyClass;
  operations: string[];
  requiredMethods: Array<"supports" | "plan" | "apply" | "validate" | "rollback">;
  automatic: boolean;
}

export const TRANSFORM_CONTRACTS: TransformContract[] = [
  {
    id: "remove_unused_import",
    label: "Remove unused import",
    safety: "SAFE",
    operations: ["EDIT_IMPORT"],
    requiredMethods: ["supports", "plan", "apply", "validate", "rollback"],
    automatic: true,
  },
  {
    id: "remove_unused_export",
    label: "Remove unused export",
    safety: "SAFE",
    operations: ["EDIT_EXPORT"],
    requiredMethods: ["supports", "plan", "apply", "validate", "rollback"],
    automatic: true,
  },
  {
    id: "remove_unused_dependency",
    label: "Remove unused dependency",
    safety: "SAFE",
    operations: ["EDIT_PACKAGE_JSON", "UPDATE_LOCKFILE"],
    requiredMethods: ["supports", "plan", "apply", "validate", "rollback"],
    automatic: true,
  },
  {
    id: "delete_temp_or_backup_file",
    label: "Delete unreferenced temporary/backup file",
    safety: "SAFE",
    operations: ["DELETE_FILE"],
    requiredMethods: ["supports", "plan", "apply", "validate", "rollback"],
    automatic: true,
  },
  {
    id: "delete_safe_orphan_module",
    label: "Delete safe orphan module",
    safety: "SAFE",
    operations: ["DELETE_FILE"],
    requiredMethods: ["supports", "plan", "apply", "validate", "rollback"],
    automatic: true,
  },
  {
    id: "remove_dead_package_script",
    label: "Remove dead package script",
    safety: "SAFE",
    operations: ["EDIT_PACKAGE_JSON"],
    requiredMethods: ["supports", "plan", "apply", "validate", "rollback"],
    automatic: true,
  },
  {
    id: "remove_empty_file",
    label: "Remove empty unneeded file",
    safety: "SAFE",
    operations: ["DELETE_FILE"],
    requiredMethods: ["supports", "plan", "apply", "validate", "rollback"],
    automatic: true,
  },
  {
    id: "consolidate_exact_duplicate",
    label: "Consolidate exact duplicate",
    safety: "SAFE",
    operations: ["REWRITE_IMPORTS", "DELETE_FILE"],
    requiredMethods: ["supports", "plan", "apply", "validate", "rollback"],
    automatic: true,
  },
  {
    id: "consolidate_near_duplicate",
    label: "Consolidate near-duplicate component/utility",
    safety: "REVIEW_FIRST",
    operations: ["REWRITE_IMPORTS", "DELETE_FILE", "EDIT_FILE"],
    requiredMethods: ["supports", "plan", "apply", "validate", "rollback"],
    automatic: false,
  },
  {
    id: "merge_duplicate_api_clients",
    label: "Merge repeated API clients",
    safety: "REVIEW_FIRST",
    operations: ["REWRITE_IMPORTS", "EDIT_FILE", "DELETE_FILE"],
    requiredMethods: ["supports", "plan", "apply", "validate", "rollback"],
    automatic: false,
  },
  {
    id: "remove_redundant_route",
    label: "Remove redundant route",
    safety: "REVIEW_FIRST",
    operations: ["DELETE_FILE", "REWRITE_IMPORTS"],
    requiredMethods: ["supports", "plan", "apply", "validate", "rollback"],
    automatic: false,
  },
  {
    id: "remove_abandoned_feature_folder",
    label: "Remove abandoned feature folder",
    safety: "REVIEW_FIRST",
    operations: ["DELETE_FILE"],
    requiredMethods: ["supports", "plan", "apply", "validate", "rollback"],
    automatic: false,
  },
  {
    id: "protected_no_op",
    label: "Protected path — never autonomous",
    safety: "PROTECTED",
    operations: [],
    requiredMethods: ["supports", "plan", "apply", "validate", "rollback"],
    automatic: false,
  },
];

export const PROTECTED_PATH_DOMAINS = [
  "authentication",
  "payment",
  "wallet",
  "database_migrations",
  "secrets",
  "environment_handling",
  "deployment_configuration",
  "security_policy",
  "generated_schemas",
  "production_infrastructure",
  "legal_compliance",
  "owner_protection_rules",
] as const;
