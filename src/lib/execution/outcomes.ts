/** User-facing product outcomes — never expose generic "Skipped" as a final result. */

export type ProductOutcome =
  | "verified_fix"
  | "review_ready_change"
  | "rolled_back_regression"
  | "blocked_source_changed"
  | "blocked_dynamic_usage"
  | "blocked_protected_path"
  | "intentional_duplication"
  | "unsupported_transformation"
  | "no_safe_action"
  | "execution_failed";

export type RunFinalStatus =
  | "verified_fix"
  | "review_ready_change"
  | "no_safe_action"
  | "execution_failed";

export const PRODUCT_OUTCOME_LABELS: Record<ProductOutcome, string> = {
  verified_fix: "Verified and retained",
  review_ready_change: "Needs review",
  rolled_back_regression: "Rolled back: introduced regression",
  blocked_source_changed: "Blocked: source changed after scan",
  blocked_dynamic_usage: "Needs review: dynamic usage cannot be ruled out",
  blocked_protected_path: "Blocked: protected path",
  intentional_duplication: "Intentional duplication",
  unsupported_transformation: "Unsupported transformation",
  no_safe_action: "No eligible fix found",
  execution_failed: "Execution failed",
};

export function formatProductOutcomeLabel(
  outcome: ProductOutcome,
  detail?: string
): string {
  const base = PRODUCT_OUTCOME_LABELS[outcome];
  if (!detail) return base;
  if (outcome === "rolled_back_regression") {
    return `Rolled back: introduced ${detail}`;
  }
  return `${base} — ${detail}`;
}

export function deriveAttemptProductOutcome(input: {
  internalStatus: "retained" | "skipped" | "rejected";
  reason: string;
  pluginId: string;
  comparison?: Array<{ name: string; outcome: string }>;
}): ProductOutcome {
  if (input.internalStatus === "retained") return "verified_fix";

  const reason = input.reason.toLowerCase();

  if (input.internalStatus === "rejected") {
    if (reason.includes("protected") || reason.includes("do not touch")) {
      return "blocked_protected_path";
    }
    if (reason.includes("duplicate") || reason.includes("intentional")) {
      return input.reason.includes("intentional")
        ? "intentional_duplication"
        : "unsupported_transformation";
    }
    if (reason.includes("dynamic")) return "blocked_dynamic_usage";
    return "unsupported_transformation";
  }

  if (reason.includes("source changed") || reason.includes("hash mismatch")) {
    return "blocked_source_changed";
  }
  if (reason.includes("dynamic") || reason.includes("jsx") || reason.includes("reference found")) {
    return "blocked_dynamic_usage";
  }
  if (reason.includes("protected")) return "blocked_protected_path";
  if (
    reason.includes("verification introduced") ||
    reason.includes("new failure") ||
    reason.includes("regression")
  ) {
    return "rolled_back_regression";
  }
  if (reason.includes("no diff") || reason.includes("could not produce")) {
    return "unsupported_transformation";
  }
  if (reason.includes("patch validation")) return "unsupported_transformation";

  const introduced = input.comparison?.filter((c) =>
    c.outcome.toLowerCase().includes("new regression")
  );
  if (introduced?.length) return "rolled_back_regression";

  return "unsupported_transformation";
}

export function deriveRunFinalStatus(input: {
  retainedCount: number;
  attemptCount: number;
  mode: "auto_fix" | "review_plan";
  hadExecutionError?: boolean;
}): RunFinalStatus {
  if (input.hadExecutionError && input.retainedCount === 0) {
    return "execution_failed";
  }
  if (input.mode === "review_plan") return "review_ready_change";
  if (input.retainedCount > 0) return "verified_fix";
  if (input.attemptCount > 0) return "no_safe_action";
  return "no_safe_action";
}

export function buildNoSafeActionSummary(input: {
  evaluated: number;
  retained: number;
  outcomes: ProductOutcome[];
}): string {
  if (input.retained > 0) {
    return `${input.retained} verified fix${input.retained === 1 ? "" : "es"} retained`;
  }
  if (input.evaluated === 0) {
    return "No eligible candidates were evaluated.";
  }
  const rolled = input.outcomes.filter((o) => o === "rolled_back_regression").length;
  const dynamic = input.outcomes.filter((o) => o === "blocked_dynamic_usage").length;
  const protected_ = input.outcomes.filter((o) => o === "blocked_protected_path").length;
  const unsupported = input.outcomes.filter(
    (o) => o === "unsupported_transformation"
  ).length;

  const parts = [
    `RepoDiet evaluated ${input.evaluated} candidate${input.evaluated === 1 ? "" : "s"}.`,
    `${input.retained} changes retained.`,
  ];
  const blockers: string[] = [];
  if (rolled) blockers.push(`${rolled} rejected by verification`);
  if (dynamic) blockers.push(`${dynamic} had unresolved dynamic usage`);
  if (protected_) blockers.push(`${protected_} belonged to a protected route`);
  if (unsupported) blockers.push(`${unsupported} unsupported transformation`);
  if (blockers.length) {
    parts.push(blockers.join(", ") + ".");
  }
  parts.push("No unsafe change was applied.");
  return parts.join(" ");
}

/** User-facing labels must never be the generic word "Skipped". */
export function assertNoGenericSkippedLabel(label: string): boolean {
  return !/\bskipped\b/i.test(label);
}
