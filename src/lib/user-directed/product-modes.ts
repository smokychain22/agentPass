/**
 * Product interaction modes — outcome-first by default.
 */

export type ProductMode = "AUTOMATIC_CLEANUP" | "GUIDED_REVIEW" | "ADVANCED";

export const PRODUCT_MODES: ProductMode[] = [
  "AUTOMATIC_CLEANUP",
  "GUIDED_REVIEW",
  "ADVANCED",
];

export const DEFAULT_PRODUCT_MODE: ProductMode = "AUTOMATIC_CLEANUP";

export type WorkbenchStage = "review" | "plan" | "pay" | "delivery";

export const WORKBENCH_STAGES: Array<{ id: WorkbenchStage; label: string }> = [
  { id: "review", label: "Review" },
  { id: "plan", label: "Plan" },
  { id: "pay", label: "Pay" },
  { id: "delivery", label: "Delivery" },
];

export function isAdvancedMode(mode: ProductMode): boolean {
  return mode === "ADVANCED";
}
