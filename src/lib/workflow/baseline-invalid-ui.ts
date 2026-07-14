import type { BaselineReadinessResult } from "./baseline-readiness";
import { isKnownBaselineInvalidCommit, repositoryCommitUrl } from "./known-invalid-commits";

export interface BaselineInvalidUi {
  title: string;
  sourceCommit: string;
  failedCheck: string;
  classification: string;
  action: string;
  stderrExcerpt?: string;
  hideRetry: boolean;
  hideQuoteButton: boolean;
  retryLabel?: string;
  scanGuidance: string;
  commitUrl?: string;
}

export function parseBaselineInvalidUi(input: {
  message?: string;
  baseline?: BaselineReadinessResult;
  invalidation?: { status: string; requiresNewScan?: boolean };
  commitSha?: string;
  repository?: { owner: string; name: string };
}): BaselineInvalidUi | null {
  const baseline = input.baseline;
  const commit = baseline?.commitSha ?? input.commitSha ?? "unknown";
  const classification =
    baseline?.status ?? input.invalidation?.status ?? "baseline_invalid";

  const knownInvalid = commit !== "unknown" && isKnownBaselineInvalidCommit(commit);
  const messageInvalid = input.message?.includes("Repository baseline invalid");

  if (
    !knownInvalid &&
    !messageInvalid &&
    classification !== "baseline_invalid" &&
    classification !== "baseline_environment_blocked" &&
    classification !== "baseline_infrastructure_failed" &&
    classification !== "invalid_source_baseline" &&
    classification !== "stale_source_commit"
  ) {
    return null;
  }

  const commitUrl =
    input.repository && commit !== "unknown"
      ? repositoryCommitUrl({
          owner: input.repository.owner,
          name: input.repository.name,
          commitSha: commit,
        })
      : undefined;

  return {
    title: "Repository baseline invalid",
    sourceCommit: commit,
    failedCheck: baseline?.failedCheck ?? "npm run build",
    classification: knownInvalid ? "baseline_invalid" : classification,
    action:
      baseline?.action ??
      (classification === "stale_source_commit"
        ? "Run a new scan after the repository is repaired."
        : "Repair the repository source and run a new scan."),
    stderrExcerpt: baseline?.stderrExcerpt,
    hideRetry: true,
    hideQuoteButton: true,
    retryLabel: "Run a new scan after the repository is repaired.",
    scanGuidance:
      "A new scan is useful only after repository HEAD changes. Refreshing a quote cannot repair the source commit.",
    commitUrl,
  };
}

export function formatBaselineInvalidBanner(ui: BaselineInvalidUi): string {
  const lines = [
    ui.title,
    `Source commit: ${ui.sourceCommit}`,
    `Failed check: ${ui.failedCheck}`,
    `Classification: ${ui.classification}`,
    `Action: ${ui.action}`,
  ];
  if (ui.stderrExcerpt?.trim()) {
    lines.push(`Diagnostic: ${ui.stderrExcerpt.trim().slice(0, 300)}`);
  }
  return lines.join("\n");
}
