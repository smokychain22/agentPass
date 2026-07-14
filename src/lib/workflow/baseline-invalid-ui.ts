import type { BaselineReadinessResult } from "./baseline-readiness";

export interface BaselineInvalidUi {
  title: string;
  sourceCommit: string;
  failedCheck: string;
  classification: string;
  action: string;
  stderrExcerpt?: string;
  hideRetry: boolean;
  retryLabel?: string;
}

export function parseBaselineInvalidUi(input: {
  message?: string;
  baseline?: BaselineReadinessResult;
  invalidation?: { status: string; requiresNewScan?: boolean };
  commitSha?: string;
}): BaselineInvalidUi | null {
  const baseline = input.baseline;
  const commit = baseline?.commitSha ?? input.commitSha ?? "unknown";
  const classification =
    baseline?.status ?? input.invalidation?.status ?? "baseline_invalid";

  if (
    classification !== "baseline_invalid" &&
    classification !== "baseline_environment_blocked" &&
    classification !== "baseline_infrastructure_failed" &&
    classification !== "invalid_source_baseline" &&
    classification !== "stale_source_commit"
  ) {
    if (!input.message?.includes("Repository baseline invalid")) return null;
  }

  return {
    title: "Repository baseline invalid",
    sourceCommit: commit,
    failedCheck: baseline?.failedCheck ?? "npm run build",
    classification,
    action:
      baseline?.action ??
      (classification === "stale_source_commit"
        ? "Run a new scan after the repository is repaired."
        : "Repair the repository source and run a new scan."),
    stderrExcerpt: baseline?.stderrExcerpt,
    hideRetry: true,
    retryLabel: "Run a new scan after the repository is repaired.",
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
