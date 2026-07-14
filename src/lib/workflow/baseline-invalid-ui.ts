import type { BaselineReadinessResult } from "./baseline-readiness";
import { isKnownBaselineInvalidCommit, repositoryCommitUrl } from "./known-invalid-commits";

export interface BaselineInvalidUi {
  title: string;
  sourceCommit: string;
  failedCheck: string;
  classification: string;
  action: string;
  stderrExcerpt?: string;
  firstActionableError?: string;
  errorLocation?: string;
  errorCode?: string;
  causedByCleanup: boolean;
  hideRetry: boolean;
  hideQuoteButton: boolean;
  retryLabel?: string;
  scanGuidance: string;
  commitUrl?: string;
  fileUrl?: string;
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
    baseline?.classification ??
    baseline?.status ??
    input.invalidation?.status ??
    "baseline_invalid";

  const knownInvalid = commit !== "unknown" && isKnownBaselineInvalidCommit(commit);
  const messageInvalid = input.message?.includes("Repository baseline invalid");

  if (
    !knownInvalid &&
    !messageInvalid &&
    classification !== "baseline_invalid" &&
    classification !== "baseline_source_invalid" &&
    classification !== "pre_existing_repository_error" &&
    classification !== "baseline_environment_blocked" &&
    classification !== "baseline_infrastructure_failed" &&
    classification !== "baseline_dependency_failure" &&
    classification !== "invalid_source_baseline" &&
    classification !== "stale_source_commit"
  ) {
    return null;
  }

  const err = baseline?.firstActionableError;
  const errorLocation =
    err?.filePath && err.line
      ? `${err.filePath}:${err.line}${err.column ? `:${err.column}` : ""}`
      : err?.filePath;

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
        : "Repair this existing build error, merge the repair, then run a new scan."),
    stderrExcerpt: err?.message ?? baseline?.stderrExcerpt,
    firstActionableError: err?.message,
    errorLocation,
    errorCode: err?.errorCode,
    causedByCleanup: err?.causedByCleanup ?? false,
    hideRetry: true,
    hideQuoteButton: true,
    retryLabel: "Run a new scan after the repository is repaired.",
    scanGuidance:
      "A new scan is useful only after repository HEAD changes. Refreshing a quote cannot repair the source commit.",
    commitUrl,
    fileUrl: err?.fileUrl,
  };
}

export function formatBaselineInvalidBanner(ui: BaselineInvalidUi): string {
  const lines = [
    ui.title,
    `Source commit: ${ui.sourceCommit}`,
    `Failed check: ${ui.failedCheck}`,
  ];
  if (ui.errorLocation) {
    lines.push(`First actionable error: ${ui.errorLocation}`);
  }
  if (ui.firstActionableError?.trim()) {
    lines.push(`Diagnostic: ${ui.firstActionableError.trim().slice(0, 300)}`);
  } else if (ui.stderrExcerpt?.trim()) {
    lines.push(`Diagnostic: ${ui.stderrExcerpt.trim().slice(0, 300)}`);
  }
  lines.push(
    `Classification: ${ui.classification}`,
    "RepoDiet-selected cleanup caused this: No",
    `Required action: ${ui.action}`
  );
  return lines.join("\n");
}
