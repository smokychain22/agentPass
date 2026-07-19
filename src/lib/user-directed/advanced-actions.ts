import type { Finding } from "@/lib/findings/types";
import type { RequestedActionType } from "./types";
import { recommendedActionForFinding } from "./recommended-action";

/**
 * Primary progressive-disclosure actions for Advanced mode.
 * Full list only after "More actions".
 */
export const ADVANCED_PRIMARY_ACTIONS = [
  "use_recommendation",
  "describe_change",
  "keep_file",
  "more_actions",
] as const;

export type AdvancedPrimaryAction = (typeof ADVANCED_PRIMARY_ACTIONS)[number];

/** Visible action menu — SUPPRESS only once (no duplicate ignore labels). */
export const ADVANCED_FULL_ACTION_TYPES: RequestedActionType[] = [
  "INSPECT",
  "DELETE",
  "EDIT",
  "RENAME",
  "MOVE",
  "CONSOLIDATE_DUPLICATES",
  "CHOOSE_CANONICAL",
  "REMOVE_DEPENDENCY",
  "UPDATE_REFERENCES",
  "UPDATE_CONFIGURATION",
  "REGENERATE",
  "KEEP",
  "SUPPRESS",
  "CUSTOM",
];

export const ADVANCED_ACTION_LABELS: Record<RequestedActionType, string> = {
  INSPECT: "Inspect",
  DELETE: "Delete",
  EDIT: "Edit",
  RENAME: "Rename",
  MOVE: "Move",
  CONSOLIDATE_DUPLICATES: "Consolidate duplicate",
  CHOOSE_CANONICAL: "Choose as canonical duplicate",
  REMOVE_DEPENDENCY: "Remove dependency",
  UPDATE_REFERENCES: "Replace references",
  UPDATE_CONFIGURATION: "Update configuration",
  REGENERATE: "Regenerate",
  KEEP: "Keep this file",
  SUPPRESS: "Add to ignore policy",
  ADD_IGNORE_POLICY: "Add to ignore policy",
  CUSTOM: "Request custom cleanup",
};

/**
 * Filter full actions by file/evidence context so irrelevant ops stay hidden.
 */
export function contextualAdvancedActions(input: {
  path?: string;
  finding?: Finding | null;
}): RequestedActionType[] {
  const path = input.path ?? input.finding?.files[0] ?? "";
  const finding = input.finding ?? null;
  const lower = path.toLowerCase();
  const isPackageJson = /(^|\/)package\.json$/.test(lower);
  const isConfig =
    /\.(config|rc)\.[cm]?[jt]sx?$/.test(lower) ||
    /(^|\/)(tsconfig|jsconfig|next\.config|vite\.config)/.test(lower);
  const isGenerated =
    finding?.evidence.signals?.some((s) => /generated/i.test(s)) ||
    /(^|\/)(dist|build|generated|__generated__)\//.test(lower);

  const recommended = finding
    ? recommendedActionForFinding(finding)
    : ("DELETE" as RequestedActionType);

  const base = new Set<RequestedActionType>([
    "INSPECT",
    recommended,
    "KEEP",
    "SUPPRESS",
    "CUSTOM",
  ]);

  if (finding?.type === "duplicate_code") {
    base.add("CONSOLIDATE_DUPLICATES");
    base.add("CHOOSE_CANONICAL");
    base.add("UPDATE_REFERENCES");
  }
  if (finding?.type === "unused_dependency" || isPackageJson) {
    base.add("REMOVE_DEPENDENCY");
  }
  if (finding?.type === "unused_import" || finding?.type === "unused_export") {
    base.add("EDIT");
    base.add("UPDATE_REFERENCES");
  }
  if (isConfig) {
    base.add("UPDATE_CONFIGURATION");
    base.add("EDIT");
  }
  if (isGenerated) {
    base.add("REGENERATE");
    base.delete("DELETE");
  }
  if (path) {
    base.add("RENAME");
    base.add("MOVE");
    base.add("EDIT");
  }

  return ADVANCED_FULL_ACTION_TYPES.filter((t) => base.has(t));
}
