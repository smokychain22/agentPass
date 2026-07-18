import type { WorkflowA2ATask } from "./client";

/** Truthful OKX A2A / delivery UI phases — never invent success. */
export type DeliveryUiPhase =
  | "preparing_task"
  | "awaiting_okx_authorization"
  | "awaiting_escrow_funding"
  | "escrow_funded"
  | "cleanup_running"
  | "verification_running"
  | "pr_ready_for_review"
  | "awaiting_acceptance"
  | "accepted_and_released"
  | "rejected"
  | "disputed"
  | "failed"
  | "cancelled"
  | "connected"
  | "ready";

export interface DeliveryProgressStep {
  id: string;
  label: string;
  done: boolean;
  active: boolean;
}

const CLEANUP_STATUSES = new Set([
  "queued",
  "fetching_repository",
  "analyzing",
  "generating_changes",
  "validating_patch",
]);

const VERIFY_STATUSES = new Set(["verifying", "awaiting_approval"]);

const PR_REVIEW_STATUSES = new Set([
  "creating_pull_request",
  "monitoring_checks",
  "delivery_ready",
]);

const AWAITING_ACCEPTANCE = new Set(["delivery_submitted", "buyer_accepted"]);

const FAILED_STATUSES = new Set([
  "payment_failed",
  "verification_failed",
  "delivery_failed",
  "analysis_failed",
  "checks_failed",
  "owner_action_required",
  "expired",
]);

export function deliveryUiPhase(input: {
  githubConnected: boolean;
  hasQuote: boolean;
  task: WorkflowA2ATask | null;
  preparingTask?: boolean;
}): DeliveryUiPhase {
  const { task } = input;
  if (input.preparingTask) return "preparing_task";
  if (task?.status === "cancelled") return "cancelled";
  if (task?.status === "rejected") return "rejected";
  if (task?.status === "disputed") return "disputed";
  if (task && FAILED_STATUSES.has(task.status)) return "failed";
  if (task?.status === "completed" || task?.status === "escrow_released") {
    return "accepted_and_released";
  }
  if (task && AWAITING_ACCEPTANCE.has(task.status)) return "awaiting_acceptance";
  if (task && PR_REVIEW_STATUSES.has(task.status)) return "pr_ready_for_review";
  if (task && VERIFY_STATUSES.has(task.status)) return "verification_running";
  if (task && CLEANUP_STATUSES.has(task.status)) return "cleanup_running";
  if (task?.status === "funded") return "escrow_funded";
  if (task?.status === "awaiting_payment" || task?.status === "quote_required" || task?.status === "submitted") {
    if (input.hasQuote) return "awaiting_escrow_funding";
    return "awaiting_okx_authorization";
  }
  if (input.hasQuote) return "awaiting_okx_authorization";
  if (input.githubConnected) return "ready";
  return "connected";
}

export function deliveryProgressSteps(task: WorkflowA2ATask | null): DeliveryProgressStep[] {
  const status = task?.status ?? "";
  const escrowFunded =
    Boolean(task) &&
    status !== "awaiting_payment" &&
    status !== "quote_required" &&
    status !== "submitted" &&
    status !== "payment_failed";
  const cleanupDone =
    escrowFunded && !CLEANUP_STATUSES.has(status) && status !== "awaiting_payment";
  const verifyDone =
    cleanupDone && !VERIFY_STATUSES.has(status) && !CLEANUP_STATUSES.has(status);
  const prReady =
    Boolean(task?.pullRequest?.url) ||
    PR_REVIEW_STATUSES.has(status) ||
    AWAITING_ACCEPTANCE.has(status) ||
    status === "completed" ||
    status === "escrow_released";
  const accepted = status === "buyer_accepted" || status === "escrow_released" || status === "completed";
  const released = status === "escrow_released" || status === "completed";

  const steps: Array<{ id: string; label: string; done: boolean }> = [
    { id: "authorize", label: "Authorize RepoDiet A2A service 32947", done: Boolean(task) },
    { id: "escrow", label: "Fund OKX escrow", done: escrowFunded },
    { id: "cleanup", label: "Cleanup running", done: cleanupDone || verifyDone || prReady },
    { id: "verify", label: "Verification running", done: verifyDone || prReady },
    { id: "pr", label: "PR ready for review", done: prReady },
    { id: "accept", label: "Awaiting acceptance", done: accepted },
    { id: "release", label: "Accepted and released", done: released },
  ];

  let activeAssigned = false;
  return steps.map((step) => {
    const active = !step.done && !activeAssigned;
    if (active) activeAssigned = true;
    return { ...step, active };
  });
}

export interface DeliveryFailureRecovery {
  whatFailed: string;
  paymentConfirmed: boolean;
  repositoryFilesChanged: boolean;
  branchOrPrExists: boolean;
  retrySafe: boolean;
  nextStep: string;
}

export function deliveryFailureRecovery(task: WorkflowA2ATask | null): DeliveryFailureRecovery | null {
  if (!task) return null;
  if (
    !FAILED_STATUSES.has(task.status) &&
    task.status !== "owner_action_required" &&
    task.status !== "rejected" &&
    task.status !== "disputed"
  ) {
    return null;
  }
  const paymentConfirmed = !["awaiting_payment", "payment_failed", "quote_required"].includes(
    task.status
  );
  const branchOrPrExists = Boolean(task.pullRequest?.url || task.pullRequest?.branch);
  return {
    whatFailed: task.error || `Cleanup stopped with status “${task.status.replaceAll("_", " ")}”.`,
    paymentConfirmed,
    repositoryFilesChanged: false,
    branchOrPrExists,
    retrySafe: paymentConfirmed && task.status !== "disputed",
    nextStep:
      task.status === "disputed"
        ? "Continue dispute resolution in OKX.AI. Escrow remains under OKX arbitration rules."
        : task.status === "rejected"
          ? "Delivery was rejected. Escrow follows OKX rejection rules — do not expect RepoDiet to reverse escrow itself."
          : paymentConfirmed
            ? branchOrPrExists
              ? "Review the pull request on GitHub, or retry delivery. Escrow remains funded — do not fund again."
              : "Retry cleanup delivery without funding escrow again. Escrow was already funded."
            : "Authorize RepoDiet on OKX.AI again, fund escrow with a fresh quote, then continue.",
  };
}
