import type { Finding } from "@/lib/findings/types";
import type { FindingDecisionState } from "./decision-store";
import type { FindingStatusLabel } from "./recommended-action";

export interface FindingCardAction {
  id: string;
  label: string;
  kind: "primary" | "secondary";
  decision: FindingDecisionState;
  canonicalFile?: string;
  filesToRemove?: string[];
  filesToKeep?: string[];
  /** Plain-language statement of exactly what happens if this action is chosen. */
  consequence: string;
}

function shortName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

/**
 * One specific action set per finding type/status — never the generic
 * yes/no/not-sure triad. Every action states its exact consequence and maps
 * to a real, persisted decision (see decision-store.ts).
 */
export function buildFindingCardActions(
  finding: Finding,
  status: FindingStatusLabel
): FindingCardAction[] {
  const files = finding.files.length > 0 ? finding.files : [finding.title];

  if (status === "Needs your review") {
    const path = files[0];
    return [
      {
        id: "keep_recommended",
        label: "Keep this file (recommended)",
        kind: "primary",
        decision: "kept",
        filesToKeep: files,
        consequence: `${shortName(path)} stays exactly as it is. RepoDiet keeps this out of the cleanup plan until it can verify removal is safe.`,
      },
      {
        id: "remove_anyway",
        label: `Remove ${shortName(path)} anyway`,
        kind: "secondary",
        decision: "selected",
        filesToRemove: files,
        consequence: `${shortName(path)} is added to the cleanup plan for removal, even though RepoDiet could not fully verify it is unused.`,
      },
      {
        id: "exclude",
        label: "Exclude from cleanup",
        kind: "secondary",
        decision: "excluded",
        consequence: `${shortName(path)} is left out of this cleanup entirely — no change, no further review.`,
      },
    ];
  }

  if (finding.type === "duplicate_code" && files.length >= 2) {
    const [first, ...rest] = files;
    const actions: FindingCardAction[] = [
      {
        id: `use_${first}`,
        label: `Use ${shortName(first)} and remove the ${rest.length > 1 ? "copies" : "copy"}`,
        kind: "primary",
        decision: "selected",
        canonicalFile: first,
        filesToRemove: rest,
        consequence: `${shortName(first)} becomes the canonical file. RepoDiet will update references and remove ${rest.map(shortName).join(", ")} after verifying it is safe.`,
      },
    ];
    if (files.length === 2) {
      actions.push({
        id: `use_${rest[0]}`,
        label: "Choose the other file",
        kind: "secondary",
        decision: "selected",
        canonicalFile: rest[0],
        filesToRemove: [first],
        consequence: `${shortName(rest[0])} becomes the canonical file instead. RepoDiet will update references and remove ${shortName(first)}.`,
      });
    }
    actions.push(
      {
        id: "keep_both",
        label: files.length > 2 ? "Keep all files" : "Keep both files",
        kind: "secondary",
        decision: "kept",
        filesToKeep: files,
        consequence: "No files are removed. All copies stay exactly as they are.",
      },
      {
        id: "exclude",
        label: "Exclude from this cleanup",
        kind: "secondary",
        decision: "excluded",
        consequence: "This duplicate group is left out of the cleanup plan entirely.",
      }
    );
    return actions;
  }

  if (finding.type === "unused_dependency") {
    const pkg = finding.packageName ?? shortName(files[0]);
    return [
      {
        id: "remove_dependency",
        label: "Remove dependency",
        kind: "primary",
        decision: "selected",
        filesToRemove: files,
        consequence: `"${pkg}" is removed from package.json and the lockfile as part of the cleanup plan.`,
      },
      {
        id: "keep_dependency",
        label: "Keep dependency",
        kind: "secondary",
        decision: "kept",
        filesToKeep: files,
        consequence: `"${pkg}" stays in package.json — no change.`,
      },
      {
        id: "exclude",
        label: "Exclude from cleanup",
        kind: "secondary",
        decision: "excluded",
        consequence: `"${pkg}" is left out of this cleanup entirely.`,
      },
    ];
  }

  if (finding.type === "ai_slop_signal") {
    const label = files.length > 1 ? "Remove backup files" : "Remove this file";
    return [
      {
        id: "remove_files",
        label,
        kind: "primary",
        decision: "selected",
        filesToRemove: files,
        consequence: `${files.map(shortName).join(", ")} ${files.length > 1 ? "are" : "is"} removed as part of the cleanup plan.`,
      },
      {
        id: "keep_files",
        label: files.length > 1 ? "Keep these files" : "Keep this file",
        kind: "secondary",
        decision: "kept",
        filesToKeep: files,
        consequence: "No files are removed — they stay exactly as they are.",
      },
      {
        id: "exclude",
        label: "Exclude from cleanup",
        kind: "secondary",
        decision: "excluded",
        consequence: "These files are left out of this cleanup entirely.",
      },
    ];
  }

  // unused_file / unused_export / unused_import / orphan_pattern / default.
  const label = files.length > 1 ? "Remove these files" : "Remove this file";
  return [
    {
      id: "remove_files",
      label,
      kind: "primary",
      decision: "selected",
      filesToRemove: files,
      consequence: `${files.map(shortName).join(", ")} ${files.length > 1 ? "are" : "is"} removed as part of the cleanup plan.`,
    },
    {
      id: "keep_files",
      label: files.length > 1 ? "Keep these files" : "Keep this file",
      kind: "secondary",
      decision: "kept",
      filesToKeep: files,
      consequence: "No files are removed — they stay exactly as they are.",
    },
    {
      id: "exclude",
      label: "Exclude from cleanup",
      kind: "secondary",
      decision: "excluded",
      consequence: "This finding is left out of this cleanup entirely.",
    },
  ];
}
