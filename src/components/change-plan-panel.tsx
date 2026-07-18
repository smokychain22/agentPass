"use client";

import type { ReactNode } from "react";
import type { TransformationPlan } from "@/lib/user-directed/types";
import { partitionPlans } from "@/lib/user-directed/partition-plans";

type Props = {
  plans: TransformationPlan[];
  onRequestDeeperVerification: (plan: TransformationPlan) => void;
  onRequestEditPlan: (plan: TransformationPlan) => void;
  onMarkRetained: (plan: TransformationPlan) => void;
  onSuppress: (plan: TransformationPlan) => void;
};

export function ChangePlanPanel({
  plans,
  onRequestDeeperVerification,
  onRequestEditPlan,
  onMarkRetained,
  onSuppress,
}: Props) {
  const parts = partitionPlans(plans);
  const byId = new Map(plans.map((p) => [p.planId, p]));
  const cleanupEligible = parts.cleanupEligiblePlans
    .map((id) => byId.get(id))
    .filter(Boolean) as TransformationPlan[];
  const blocked = parts.blockedPlans
    .map((id) => byId.get(id))
    .filter(Boolean) as TransformationPlan[];
  const needsVerification = blocked.filter(
    (p) => p.status === "DEEPER_VERIFICATION_REQUIRED"
  );
  const needsDecision = blocked.filter((p) => p.status === "USER_DECISION_REQUIRED");
  const otherBlocked = blocked.filter(
    (p) =>
      p.status !== "DEEPER_VERIFICATION_REQUIRED" && p.status !== "USER_DECISION_REQUIRED"
  );

  if (plans.length === 0) {
    return (
      <section className="space-y-2 rounded-md border border-border/50 bg-card/30 p-4" aria-label="Change plan">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Change Plan</p>
        <h2 className="text-lg font-semibold">Deterministic transformation plans</h2>
        <p className="text-sm text-muted-foreground">
          Analyze a selection to produce plans. Selection never equals automatic eligibility.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-md border border-border/50 bg-card/30 p-4" aria-label="Change plan">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Change Plan</p>
          <h2 className="mt-1 text-lg font-semibold">Verified transformation plans</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Only cleanup-eligible plans can proceed to patch preview and quoting.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded border border-signal/40 px-2 py-1 text-signal">
            {cleanupEligible.length} eligible
          </span>
          <span className="rounded border border-amber-500/40 px-2 py-1 text-amber-200">
            {needsVerification.length} verify
          </span>
          <span className="rounded border border-border/50 px-2 py-1">
            {needsDecision.length} decision
          </span>
          <span className="rounded border border-destructive/40 px-2 py-1 text-destructive">
            {otherBlocked.length} blocked
          </span>
        </div>
      </div>

      {cleanupEligible.map((plan) => (
        <PlanCard key={plan.planId} plan={plan} />
      ))}

      {needsVerification.map((plan) => (
        <PlanCard
          key={plan.planId}
          plan={plan}
          actions={
            <>
              <button
                type="button"
                className="rounded border border-border/50 px-2 py-1 text-xs"
                onClick={() => onRequestDeeperVerification(plan)}
              >
                Run deeper verification
              </button>
              <button
                type="button"
                className="rounded border border-border/50 px-2 py-1 text-xs"
                onClick={() => onRequestEditPlan(plan)}
              >
                Request edit plan
              </button>
              <button
                type="button"
                className="rounded border border-border/50 px-2 py-1 text-xs"
                onClick={() => onMarkRetained(plan)}
              >
                Mark as intentionally retained
              </button>
              <button
                type="button"
                className="rounded border border-border/50 px-2 py-1 text-xs"
                onClick={() => onSuppress(plan)}
              >
                Suppress this finding
              </button>
            </>
          }
        />
      ))}

      {needsDecision.map((plan) => (
        <PlanCard
          key={plan.planId}
          plan={plan}
          actions={
            <>
              <button
                type="button"
                className="rounded border border-border/50 px-2 py-1 text-xs"
                onClick={() => onRequestDeeperVerification(plan)}
              >
                Provide confirmation / deeper verification
              </button>
              <button
                type="button"
                className="rounded border border-border/50 px-2 py-1 text-xs"
                onClick={() => onMarkRetained(plan)}
              >
                Keep all / retain
              </button>
            </>
          }
        />
      ))}

      {otherBlocked.map((plan) => (
        <PlanCard key={plan.planId} plan={plan} />
      ))}
    </section>
  );
}

function PlanCard({
  plan,
  actions,
}: {
  plan: TransformationPlan;
  actions?: ReactNode;
}) {
  const supporting = plan.evidence.filter((e) => e.kind === "supporting");
  const contradicting = plan.evidence.filter((e) => e.kind === "contradicting");

  return (
    <article className="rounded-md border border-border/40 bg-background/40 p-3 text-sm">
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded border border-border/40 px-2 py-0.5">{plan.status}</span>
        <span className="rounded border border-border/40 px-2 py-0.5">{plan.proposedAction}</span>
        {plan.transformerId ? (
          <span className="rounded border border-border/40 px-2 py-0.5">{plan.transformerId}</span>
        ) : null}
        <span className="rounded border border-border/40 px-2 py-0.5">{plan.riskTier}</span>
      </div>
      <h3 className="mt-2 font-medium">
        {plan.selectedRepositoryPaths.length === 1 ? (
          <code className="text-xs">{plan.selectedRepositoryPaths[0]}</code>
        ) : (
          <>{plan.selectedRepositoryPaths.length} paths</>
        )}
      </h3>
      <p className="mt-1 text-foreground/90">{plan.summary}</p>
      {supporting.length ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            Supporting evidence
          </summary>
          <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
            {supporting.map((e, i) => (
              <li key={i}>
                [{e.source}] {e.detail}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {contradicting.length ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            Contradicting evidence
          </summary>
          <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
            {contradicting.map((e, i) => (
              <li key={i}>
                [{e.source}] {e.detail}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {plan.validationCommands.length ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Validation: {plan.validationCommands.join(", ")}
        </p>
      ) : null}
      <p className="mt-1 text-xs text-muted-foreground">Rollback: {plan.rollbackPlan}</p>
      {plan.nextStep ? (
        <p className="mt-1 text-xs text-muted-foreground">Next step: {plan.nextStep}</p>
      ) : null}
      {plan.blockerReason ? (
        <p className="mt-1 text-xs text-warning">{plan.blockerReason}</p>
      ) : null}
      {actions ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
    </article>
  );
}
