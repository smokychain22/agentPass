import type { Finding } from "@/lib/findings/types";

export type FixPluginId =
  | "remove_unused_file"
  | "remove_temp_backup_file"
  | "remove_unused_dependency"
  | "remove_empty_file"
  | "remove_duplicate_comment"
  | "review_only";

export interface FixPlugin {
  id: FixPluginId;
  label: string;
  risk: "low" | "review_only";
  supportedFindingTypes: Finding["type"][];
  description: string;
}

export const FIX_PLUGINS: FixPlugin[] = [
  {
    id: "remove_unused_file",
    label: "Remove unused file",
    risk: "low",
    supportedFindingTypes: ["unused_file"],
    description: "Delete a confirmed unused source file with no inbound references.",
  },
  {
    id: "remove_temp_backup_file",
    label: "Remove temp/backup file",
    risk: "low",
    supportedFindingTypes: ["unused_file", "ai_slop_signal"],
    description: "Delete obvious temporary, backup, or abandoned files.",
  },
  {
    id: "remove_unused_dependency",
    label: "Remove unused dependency",
    risk: "low",
    supportedFindingTypes: ["unused_dependency"],
    description: "Remove a confirmed unused package and update lockfile consistently.",
  },
  {
    id: "remove_empty_file",
    label: "Remove empty file",
    risk: "low",
    supportedFindingTypes: ["unused_file", "ai_slop_signal"],
    description: "Delete empty abandoned files.",
  },
  {
    id: "remove_duplicate_comment",
    label: "Remove duplicate generated comment",
    risk: "low",
    supportedFindingTypes: ["ai_slop_signal"],
    description: "Remove trivial duplicate generated comments.",
  },
  {
    id: "review_only",
    label: "Review only",
    risk: "review_only",
    supportedFindingTypes: [
      "duplicate_code",
      "orphan_pattern",
      "unused_export",
      "unused_file",
      "unused_dependency",
      "ai_slop_signal",
    ],
    description: "Requires human review — RepoDiet will not auto-modify.",
  },
];

const REVIEW_ONLY_TYPES = new Set<Finding["type"]>([
  "duplicate_code",
  "orphan_pattern",
]);

export function resolveFixPlugin(finding: Finding): FixPlugin {
  if (REVIEW_ONLY_TYPES.has(finding.type)) {
    return FIX_PLUGINS.find((p) => p.id === "review_only")!;
  }
  if (finding.type === "unused_dependency") {
    return FIX_PLUGINS.find((p) => p.id === "remove_unused_dependency")!;
  }
  if (finding.type === "ai_slop_signal") {
    return FIX_PLUGINS.find((p) => p.id === "remove_temp_backup_file")!;
  }
  if (finding.type === "unused_file") {
    const path = finding.files[0] ?? "";
    if (/(^|\/)(archive|backup|old|tmp|temp|\.bak|\.old)(\/|$)/i.test(path)) {
      return FIX_PLUGINS.find((p) => p.id === "remove_temp_backup_file")!;
    }
    return FIX_PLUGINS.find((p) => p.id === "remove_unused_file")!;
  }
  return FIX_PLUGINS.find((p) => p.id === "review_only")!;
}

export function isSupportedFixPlugin(plugin: FixPlugin): boolean {
  return plugin.risk === "low";
}
