import type { Finding } from "@/lib/findings/types";
import type { FindingDecisionState } from "./decision-store";
import type { FindingStatusLabel } from "./recommended-action";

export interface FindingCardAction {
  id: string;
  label: string;
  kind: "primary" | "secondary" | "additional";
  decision: FindingDecisionState;
  canonicalFile?: string;
  filesToRemove?: string[];
  filesToKeep?: string[];
  /** Plain-language statement of exactly what happens if this action is chosen. */
  consequence: string;
  /** Requires an explicit confirmation dialog before persisting (risky override). */
  requiresConfirmation?: boolean;
  confirmationText?: string;
  /** Expands into one action set per file instead of persisting a decision itself. */
  expandsToIndividualFiles?: boolean;
  /** Marks this decision as an explicit override of RepoDiet's own recommendation. */
  isOverride?: boolean;
}

function shortName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

/**
 * One specific action set per finding type/status — never the generic
 * yes/no/not-sure triad. "Leave unchanged" and "Exclude from cleanup" are
 * never both offered when they'd have the same practical effect. Every
 * action states its exact consequence and maps to a real, persisted
 * decision (see decision-store.ts). Protected findings get no
 * cleanup-selection actions at all.
 */
export function buildFindingCardActions(
  finding: Finding,
  status: FindingStatusLabel
): FindingCardAction[] {
  const files = finding.files.length > 0 ? finding.files : [finding.title];

  if (status === "Protected" || status === "Informational") {
    return [];
  }

  if (status === "Review suggested") {
    const path = files[0];
    return [
      {
        id: "keep_recommended",
        label: "Leave unchanged — recommended",
        kind: "primary",
        decision: "kept",
        filesToKeep: files,
        consequence: `${shortName(path)} stays exactly as it is. RepoDiet keeps this out of the cleanup plan until it can verify removal is safe.`,
      },
      {
        id: "remove_anyway",
        label: "Remove this file anyway",
        kind: "secondary",
        decision: "selected",
        filesToRemove: files,
        isOverride: true,
        requiresConfirmation: true,
        confirmationText: `RepoDiet's evidence for ${shortName(path)} is incomplete — it could not fully verify this file is unused. Removing it anyway may require updating references, and RepoDiet will run tests to check for breakage. You are overriding RepoDiet's recommendation to leave it unchanged. Continue?`,
        consequence: `${shortName(path)} is added to the cleanup plan for removal, even though RepoDiet could not fully verify it is unused.`,
      },
    ];
  }

  if (finding.type === "duplicate_code" && files.length >= 2) {
    const [first, ...rest] = files;
    const actions: FindingCardAction[] = [
      {
        id: `use_${first}`,
        label: `Keep ${shortName(first)} and remove the ${rest.length > 1 ? "copies" : "copy"}`,
        kind: "primary",
        decision: "selected",
        canonicalFile: first,
        filesToRemove: rest,
        consequence: `${shortName(first)} becomes the canonical file. RepoDiet will update references and remove ${rest.map(shortName).join(", ")} after verifying it is safe.`,
      },
      {
        id: "keep_both",
        label: files.length > 2 ? "Keep all files" : "Keep both files",
        kind: "secondary",
        decision: "kept",
        filesToKeep: files,
        consequence: "No files are removed. All copies stay exactly as they are.",
      },
    ];
    if (files.length === 2) {
      actions.push({
        id: `use_${rest[0]}`,
        label: `Choose ${shortName(rest[0])} instead`,
        kind: "additional",
        decision: "selected",
        canonicalFile: rest[0],
        filesToRemove: [first],
        consequence: `${shortName(rest[0])} becomes the canonical file instead. RepoDiet will update references and remove ${shortName(first)}.`,
      });
    } else {
      for (const alt of rest) {
        actions.push({
          id: `use_${alt}`,
          label: `Choose ${shortName(alt)} instead`,
          kind: "additional",
          decision: "selected",
          canonicalFile: alt,
          filesToRemove: files.filter((f) => f !== alt),
          consequence: `${shortName(alt)} becomes the canonical file instead. RepoDiet will update references and remove ${files
            .filter((f) => f !== alt)
            .map(shortName)
            .join(", ")}.`,
        });
      }
    }
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
        consequence: `"${pkg}" is removed from package.json and the lockfile as part of the cleanup plan. RepoDiet validates the dependency is genuinely unused and runs tests/build before delivery.`,
      },
      {
        id: "keep_dependency",
        label: "Leave unchanged",
        kind: "secondary",
        decision: "kept",
        filesToKeep: files,
        consequence: `"${pkg}" stays in package.json — no change.`,
      },
    ];
  }

  if (finding.type === "ai_slop_signal") {
    const label = files.length > 1 ? "Remove backup files" : "Remove this file";
    const actions: FindingCardAction[] = [
      {
        id: "remove_files",
        label,
        kind: "primary",
        decision: "selected",
        filesToRemove: files,
        consequence: `${files.map(shortName).join(", ")} ${files.length > 1 ? "are" : "is"} removed as part of the cleanup plan.`,
      },
    ];
    if (files.length > 1) {
      actions.push({
        id: "review_individually",
        label: "Review files individually",
        kind: "secondary",
        decision: "undecided",
        expandsToIndividualFiles: true,
        consequence: "Decide the fate of each file separately instead of all at once.",
      });
    }
    actions.push({
      id: "keep_files",
      label: files.length > 1 ? "Leave unchanged" : "Leave unchanged",
      kind: files.length > 1 ? "additional" : "secondary",
      decision: "kept",
      filesToKeep: files,
      consequence: "No files are removed — they stay exactly as they are.",
    });
    return actions;
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
      label: "Leave unchanged",
      kind: "secondary",
      decision: "kept",
      filesToKeep: files,
      consequence: "No files are removed — they stay exactly as they are.",
    },
  ];
}
