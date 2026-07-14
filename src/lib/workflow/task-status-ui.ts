import type { WorkflowA2ATask } from "./client";

const STATUS_LABELS: Record<string, string> = {
  awaiting_payment: "Waiting for payment",
  funded: "Payment received",
  generating_changes: "Generating cleanup changes",
  validating_patch: "Validating patch",
  verifying: "Verifying in sandbox",
  awaiting_approval: "Ready to open pull request",
  creating_pull_request: "Creating pull request",
  monitoring_checks: "Monitoring required GitHub checks",
  delivery_ready: "Delivery ready — required checks passed",
  checks_failed: "Required provider checks failed",
  diagnosis_ready: "Check failure diagnosed — review required",
  owner_action_required: "Owner action required in deployment provider",
  completed: "Cleanup pull request delivered",
  payment_failed: "Payment failed",
  verification_failed: "Verification failed",
  delivery_failed: "Pull request delivery failed",
  analysis_failed: "Cleanup preparation failed",
};

export function workflowTaskStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replaceAll("_", " ");
}

export function isWorkflowTaskTerminal(task: WorkflowA2ATask | null | undefined): boolean {
  if (!task) return false;
  return new Set([
    "completed",
    "delivery_ready",
    "payment_failed",
    "verification_failed",
    "delivery_failed",
    "analysis_failed",
    "checks_failed",
    "owner_action_required",
    "cancelled",
    "expired",
  ]).has(task.status);
}

export function isWorkflowTaskFailure(task: WorkflowA2ATask | null | undefined): boolean {
  if (!task) return false;
  return new Set([
    "payment_failed",
    "verification_failed",
    "delivery_failed",
    "analysis_failed",
    "checks_failed",
    "owner_action_required",
  ]).has(task.status);
}

export function workflowFailureGuidance(task: WorkflowA2ATask | null | undefined): string {
  if (!task) return "";
  const err = task.error ?? "";

  if (err.includes("Repository baseline invalid") || err.includes("baseline_invalid")) {
    return "Repository baseline invalid. Repair the repository source and run a new scan before requesting a quote.";
  }

  if (err.includes("Mandatory verification gates failed") && err.includes("production build")) {
    return "Repository baseline invalid. Production build failed on the pinned source commit before cleanup could be verified. Repair the repository source and run a new scan.";
  }

  if (err.includes("malformed TypeScript") || err.includes("earlier cleanup PR")) {
    return "The selected source commit already contains malformed TypeScript introduced by an earlier cleanup PR. Repair the source repository and run a new scan before paying again.";
  }

  if (err.includes("PATCH_REGRESSION") || err.includes("patch regression")) {
    return "Cleanup introduced a new build or typecheck regression compared to the baseline. The patch was rejected — do not bypass the production build gate.";
  }

  if (err.includes("PATCH_GENERATION_FAILED")) {
    return "RepoDiet could not generate an applyable patch for the selected scope. This usually means the selected files could not be modified in a verified way. Select fewer findings with confirmed eligibility dry-run, then start a new cleanup attempt.";
  }

  if (err.includes("baseline lint") || err.includes("already fails lint")) {
    return "The repository already fails lint on the scanned commit. RepoDiet treats lint as advisory when build/typecheck are available — start a new cleanup attempt after the latest deploy.";
  }

  if (err.includes("Baseline repository already fails") || err.includes("already fails build")) {
    return "The scanned commit already fails build in the sandbox (often missing app env vars). After the latest deploy, start a new cleanup attempt — pre-existing build failures no longer block delivery when cleanup does not make them worse.";
  }

  if (err.includes("baseline") && err.includes("failed in sandbox")) {
    return "Repository baseline checks failed in the verification sandbox before cleanup could be compared. Try fewer findings, or fix failing build/typecheck on the source branch, then start a new cleanup attempt.";
  }

  if (task.status === "delivery_failed") {
    return "Payment was accepted, but GitHub pull-request delivery did not complete. Your test payment was not a wallet transfer in test mode. Start a new cleanup attempt after reviewing the error below.";
  }
  if (task.status === "checks_failed" || task.status === "owner_action_required") {
    return "Required GitHub or provider checks failed after the pull request was created. Review the Verify tab diagnosis, fix provider configuration or repository issues, then retry failed checks.";
  }
  if (task.status === "verification_failed") {
    return "Payment was accepted, but RepoDiet could not verify cleanup changes for the selected scope. Try fewer safe findings or re-run eligibility preflight before paying again.";
  }
  if (task.status === "payment_failed") {
    return "Payment was not accepted. Check your wallet address and try again.";
  }
  return task.error ?? "The cleanup task did not complete.";
}
