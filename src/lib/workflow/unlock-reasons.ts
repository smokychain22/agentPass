import type { RepositoryConnectionStatus } from "./github-repository-status";

export type FixPrLockReason =
  | "scan_incomplete"
  | "commit_not_pinned"
  | "github_not_connected"
  | "no_findings_selected"
  | "no_safe_candidates"
  | "preflight_failed"
  | "protected_scope"
  | "commit_stale"
  | "worker_unavailable"
  | "scope_not_reviewed";

export interface FixPrUnlockState {
  unlocked: boolean;
  reasons: FixPrLockReason[];
  title: string;
  body: string;
  primaryAction?: string;
  secondaryAction?: string;
}

export function buildZeroEligibleMessage(input: {
  totalFindings: number;
  reviewCount: number;
  githubConnected: boolean;
}): { title: string; body: string; primaryAction: string; secondaryAction: string } {
  return {
    title: "No findings are ready for automatic cleanup",
    body: `RepoDiet found ${input.totalFindings} issues, but none currently have enough evidence for an automatic change. Review a finding, run eligibility preflight, or reconnect GitHub if repository access is missing.`,
    primaryAction: "Review eligibility",
    secondaryAction: "Re-run findings",
  };
}

export function resolveFixPrUnlock(input: {
  scanComplete: boolean;
  commitSha?: string;
  github: RepositoryConnectionStatus | null;
  selectedFindingIds: string[];
  safeCandidateCount: number;
  scopeReviewed?: boolean;
  workerAvailable?: boolean;
  commitStale?: boolean;
}): FixPrUnlockState {
  const reasons: FixPrLockReason[] = [];

  if (!input.scanComplete) reasons.push("scan_incomplete");
  if (!input.commitSha) reasons.push("commit_not_pinned");
  if (!input.github?.connected) reasons.push("github_not_connected");
  if (input.selectedFindingIds.length === 0) reasons.push("no_findings_selected");
  if (input.safeCandidateCount === 0) reasons.push("no_safe_candidates");
  if (input.commitStale) reasons.push("commit_stale");
  if (input.workerAvailable === false) reasons.push("worker_unavailable");

  const unlocked = reasons.length === 0;

  if (reasons.includes("no_safe_candidates")) {
    const msg = buildZeroEligibleMessage({
      totalFindings: 0,
      reviewCount: 0,
      githubConnected: Boolean(input.github?.connected),
    });
    return { unlocked: false, reasons, ...msg };
  }

  if (reasons.includes("github_not_connected")) {
    if (input.github?.configured === false) {
      return {
        unlocked: false,
        reasons,
        title: "GitHub delivery is temporarily unavailable",
        body: "RepoDiet cannot verify repository access or create a pull request right now. No quote or payment will be created.",
        secondaryAction: "Back to findings",
      };
    }

    return {
      unlocked: false,
      reasons,
      title: input.github?.messages?.title ?? "Connect GitHub to continue",
      body:
        input.github?.messages?.body ??
        "Authorize RepoDiet on this repository to create an isolated cleanup branch and pull request.",
      primaryAction: input.github?.messages?.primaryAction ?? "Connect GitHub",
      secondaryAction: "Back to findings",
    };
  }

  if (unlocked) {
    return {
      unlocked: true,
      reasons: [],
      title: "Ready for paid cleanup",
      body: "Scope is locked. Continue to authorize payment and create the cleanup pull request.",
      primaryAction: "Review cleanup scope",
    };
  }

  return {
    unlocked: false,
    reasons,
    title: "Fix & PR requirements incomplete",
    body: reasons
      .map((r) => {
        switch (r) {
          case "scan_incomplete":
            return "Complete repository scan first.";
          case "commit_not_pinned":
            return "Scan must be pinned to a commit SHA.";
          case "no_findings_selected":
            return "Select at least one safe finding.";
          case "scope_not_reviewed":
            return "Review cleanup scope before payment.";
          case "commit_stale":
            return "Source commit changed since scan — re-run findings.";
          default:
            return r;
        }
      })
      .join(" "),
    primaryAction: "Back to findings",
  };
}
