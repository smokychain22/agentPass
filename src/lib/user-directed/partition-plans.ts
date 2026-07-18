import type { TransformationPlan } from "./types";

/** Selection never implies eligibility. Client-safe (no node:crypto). */
export function partitionPlans(plans: TransformationPlan[]): {
  cleanupEligiblePlans: string[];
  blockedPlans: string[];
} {
  return {
    cleanupEligiblePlans: plans
      .filter((p) => p.executable && p.status === "PLAN_READY")
      .map((p) => p.planId),
    blockedPlans: plans
      .filter((p) => !p.executable || p.status !== "PLAN_READY")
      .map((p) => p.planId),
  };
}
