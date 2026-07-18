import type { WorkflowA2ATask } from "./client";

export type DeliveryUiPhase =
  | "connected"
  | "ready"
  | "awaiting_wallet"
  | "awaiting_payment"
  | "payment_submitted"
  | "payment_confirmed"
  | "cleanup_running"
  | "verification_running"
  | "pr_created"
  | "blocked"
  | "failed";

export interface DeliveryProgressStep {
  id: string;
  label: string;
  done: boolean;
  active: boolean;
}

const CLEANUP_STATUSES = new Set([
  "funded",
  "queued",
  "fetching_repository",
  "analyzing",
  "generating_changes",
  "validating_patch",
]);

const VERIFY_STATUSES = new Set(["verifying", "awaiting_approval"]);

const PR_STATUSES = new Set([
  "creating_pull_request",
  "monitoring_checks",
  "delivery_ready",
  "delivery_submitted",
  "buyer_accepted",
  "escrow_released",
  "completed",
]);

const FAILED_STATUSES = new Set([
  "payment_failed",
  "verification_failed",
  "delivery_failed",
  "analysis_failed",
  "checks_failed",
  "owner_action_required",
  "cancelled",
  "expired",
  "rejected",
]);

export function deliveryUiPhase(input: {
  githubConnected: boolean;
  walletConnected: boolean;
  walletOnCorrectNetwork: boolean;
  hasQuote: boolean;
  task: WorkflowA2ATask | null;
}): DeliveryUiPhase {
  const { task } = input;
  if (task && FAILED_STATUSES.has(task.status)) {
    if (task.status === "owner_action_required" || task.status === "checks_failed") {
      return "blocked";
    }
    return "failed";
  }
  if (task && PR_STATUSES.has(task.status)) return "pr_created";
  if (task && VERIFY_STATUSES.has(task.status)) return "verification_running";
  if (task && CLEANUP_STATUSES.has(task.status)) return "cleanup_running";
  if (task?.status === "awaiting_payment") {
    if (!input.walletConnected) return "awaiting_wallet";
    if (!input.walletOnCorrectNetwork) return "awaiting_wallet";
    return "awaiting_payment";
  }
  if (input.hasQuote) return "awaiting_payment";
  if (input.githubConnected) return "ready";
  return "connected";
}

export function deliveryProgressSteps(task: WorkflowA2ATask | null): DeliveryProgressStep[] {
  const status = task?.status ?? "";
  const paid =
    Boolean(task) &&
    status !== "awaiting_payment" &&
    status !== "quote_required" &&
    status !== "submitted" &&
    status !== "payment_failed";
  const cleanupDone =
    paid &&
    !CLEANUP_STATUSES.has(status) &&
    status !== "awaiting_payment";
  const verifyDone = cleanupDone && !VERIFY_STATUSES.has(status) && !CLEANUP_STATUSES.has(status);
  const prReady = Boolean(task?.pullRequest?.url) || status === "completed" || status === "delivery_ready";

  const steps: Array<{ id: string; label: string; done: boolean }> = [
    { id: "payment", label: "Payment confirmed", done: paid },
    {
      id: "branch",
      label: "Creating isolated branch",
      done: cleanupDone || ["creating_pull_request", "monitoring_checks", ...PR_STATUSES].includes(status),
    },
    {
      id: "apply",
      label: "Applying selected cleanup",
      done: cleanupDone || VERIFY_STATUSES.has(status) || PR_STATUSES.has(status),
    },
    {
      id: "verify",
      label: "Running verification",
      done: verifyDone || PR_STATUSES.has(status),
    },
    {
      id: "diff",
      label: "Checking bounded diff",
      done: verifyDone || PR_STATUSES.has(status),
    },
    {
      id: "pr",
      label: "Opening pull request",
      done: prReady,
    },
    {
      id: "ready",
      label: "PR ready",
      done: prReady,
    },
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
  if (!FAILED_STATUSES.has(task.status) && task.status !== "owner_action_required") {
    return null;
  }
  const paymentConfirmed = !["awaiting_payment", "payment_failed", "quote_required"].includes(
    task.status
  );
  const branchOrPrExists = Boolean(task.pullRequest?.url || task.pullRequest?.branch);
  const repositoryFilesChanged = false; // RepoDiet never merges; only PR branch may exist.
  return {
    whatFailed: task.error || `Cleanup stopped with status “${task.status.replaceAll("_", " ")}”.`,
    paymentConfirmed,
    repositoryFilesChanged,
    branchOrPrExists,
    retrySafe: paymentConfirmed,
    nextStep: paymentConfirmed
      ? branchOrPrExists
        ? "Open the pull request on GitHub, or retry delivery without paying again."
        : "Retry cleanup delivery without paying again. Your payment was already confirmed."
      : "Fix the issue below, then connect your wallet and pay again with a fresh quote.",
  };
}
