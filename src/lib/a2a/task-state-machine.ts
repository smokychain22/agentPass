/**
 * Explicit A2A lifecycle transitions. Names map to public A2ATaskStatus where possible.
 */

import type { A2ATaskStatus, A2ATaskTransition, InternalRole } from "./types";

/** Allowed edges — invalid transitions throw. */
const ALLOWED: Partial<Record<A2ATaskStatus, A2ATaskStatus[]>> = {
  submitted: ["validating", "queued", "quote_required", "cancelled", "unsupported"],
  validating: ["queued", "quote_required", "fetching_repository", "analysis_failed", "cancelled"],
  quote_required: ["awaiting_payment", "cancelled", "expired"],
  awaiting_payment: ["funded", "payment_failed", "cancelled", "expired", "quote_required"],
  funded: ["queued", "fetching_repository", "analyzing", "awaiting_approval", "cancelled"],
  queued: ["fetching_repository", "analyzing", "cancelled", "analysis_failed"],
  fetching_repository: [
    "analyzing",
    "quote_required",
    "awaiting_approval",
    "delivery_ready",
    "analysis_failed",
    "cancelled",
  ],
  analyzing: [
    "quote_required",
    "awaiting_approval",
    "awaiting_payment",
    "delivery_ready",
    "analysis_failed",
    "cancelled",
  ],
  awaiting_approval: [
    "generating_changes",
    "creating_pull_request",
    "rejected",
    "cancelled",
    "expired",
  ],
  generating_changes: ["validating_patch", "verification_failed", "delivery_failed"],
  validating_patch: ["verifying", "creating_pull_request", "verification_failed"],
  verifying: ["creating_pull_request", "verification_failed", "checks_failed"],
  creating_pull_request: ["monitoring_checks", "delivery_ready", "delivery_failed"],
  monitoring_checks: [
    "delivery_ready",
    "checks_failed",
    "diagnosis_ready",
    "owner_action_required",
    "delivery_failed",
  ],
  checks_failed: ["diagnosis_ready", "owner_action_required", "delivery_failed", "rejected"],
  diagnosis_ready: ["owner_action_required", "delivery_ready", "rejected"],
  owner_action_required: ["delivery_ready", "rejected", "cancelled"],
  delivery_ready: ["delivery_submitted", "completed", "rejected", "disputed"],
  delivery_submitted: ["buyer_accepted", "disputed", "rejected", "expired"],
  buyer_accepted: ["escrow_released", "completed"],
  escrow_released: ["completed"],
  completed: [],
  rejected: [],
  disputed: ["rejected", "completed", "cancelled"],
  unsupported: [],
  payment_failed: ["awaiting_payment", "cancelled", "expired"],
  analysis_failed: ["queued", "fetching_repository", "cancelled", "expired"],
  verification_failed: ["generating_changes", "cancelled", "rejected"],
  delivery_failed: ["creating_pull_request", "cancelled", "rejected"],
  cancelled: [],
  expired: [],
};

export function canTransition(from: A2ATaskStatus, to: A2ATaskStatus): boolean {
  if (from === to) return true;
  const allowed = ALLOWED[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

export class A2ATaskStateMachine {
  readonly transitions: A2ATaskTransition[] = [];
  private strict: boolean;

  constructor(existing?: A2ATaskTransition[], options?: { strict?: boolean }) {
    this.strict = options?.strict ?? false;
    if (existing?.length) {
      this.transitions = [...existing];
    } else {
      this.emit("submitted", "orchestrator");
    }
  }

  emit(status: A2ATaskStatus, role: InternalRole, detail?: string): void {
    const current = this.current();
    if (this.strict && this.transitions.length > 0 && !canTransition(current, status)) {
      // Soft-allow historical recovery paths used by reconciler with explicit detail prefix.
      const recovery =
        typeof detail === "string" &&
        (detail.startsWith("reconcile:") || detail.startsWith("reconcileParentTaskFromScan:"));
      if (!recovery) {
        throw new Error(`invalid_a2a_transition:${current}->${status}`);
      }
    }
    this.transitions.push({
      status,
      at: new Date().toISOString(),
      role,
      detail,
    });
  }

  current(): A2ATaskStatus {
    return this.transitions[this.transitions.length - 1]?.status ?? "submitted";
  }

  cloneTransitions(): A2ATaskTransition[] {
    return [...this.transitions];
  }
}
