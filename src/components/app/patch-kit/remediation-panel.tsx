"use client";

import { Panel } from "@/components/design-system/panel";
import { RiskBadge } from "@/components/design-system/risk-badge";
import type { PatchKitPayload } from "@/lib/patch-kit/types";
import { remediationClassLabel } from "@/lib/patch-kit/remediation-class";
import { cn } from "@/lib/utils";

export function RemediationClassPanel({ patchKit }: { patchKit: PatchKitPayload }) {
  const plan = patchKit.remediationPlan;
  if (!plan) return null;

  const sections = [
    { key: "green" as const, items: plan.green, level: "safe" as const },
    { key: "yellow" as const, items: plan.yellow, level: "review" as const },
    { key: "red" as const, items: plan.red, level: "protected" as const },
  ];

  return (
    <Panel variant="elevated" padding="md" className="border-border/60">
      <p className="ds-label">Risk-classified remediation</p>
      <p className="mt-1 mb-4 text-sm text-muted-foreground">
        Fixes must be safer than findings. Only Green-tier items run deterministic autofix; Yellow
        produces draft patches; Red is recommendation-only.
      </p>

      <dl className="mb-4 grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-muted-foreground">Green</dt>
          <dd className="font-mono text-lg text-signal">{plan.summary.greenCount}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Yellow</dt>
          <dd className="font-mono text-lg text-amber-400">{plan.summary.yellowCount}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Red</dt>
          <dd className="font-mono text-lg">{plan.summary.redCount}</dd>
        </div>
      </dl>

      <div className="space-y-4 max-h-64 overflow-y-auto scrollbar-thin">
        {sections.map(({ key, items, level }) =>
          items.length === 0 ? null : (
            <div key={key}>
              <p className="mb-2 flex items-center gap-2 text-xs font-medium">
                <RiskBadge level={level}>{remediationClassLabel(key)}</RiskBadge>
                <span className="text-muted-foreground">({items.length})</span>
              </p>
              <ul className="space-y-2 text-xs text-muted-foreground">
                {items.slice(0, 6).map((item) => (
                  <li key={item.findingId} className="rounded border border-border/40 p-2">
                    <span className="font-mono text-foreground">{item.findingType}</span>
                    <span className="text-muted-foreground/80"> · {item.pluginId}</span>
                    <p className="mt-1">{item.reason}</p>
                    {item.autoFixAllowed && (
                      <p className="mt-1 text-signal">Autofix allowed</p>
                    )}
                    {item.draftPatchOnly && (
                      <p className="mt-1 text-amber-400/90">Draft patch only</p>
                    )}
                  </li>
                ))}
                {items.length > 6 && <li>+{items.length - 6} more</li>}
              </ul>
            </div>
          )
        )}
      </div>
    </Panel>
  );
}

export function VerificationGatesPanel({ patchKit }: { patchKit: PatchKitPayload }) {
  const report = patchKit.verificationGates;
  if (!report) return null;

  return (
    <Panel variant="elevated" padding="md" className="border-border/60">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="ds-label">Mandatory verification gates</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Draft PR opens only when required gates pass on the pinned commit.
          </p>
        </div>
        <RiskBadge level={report.allRequiredPassed ? "safe" : "review"}>
          {report.allRequiredPassed ? "Gates passed" : "Gates incomplete"}
        </RiskBadge>
      </div>

      <ul className="space-y-2 text-xs max-h-72 overflow-y-auto scrollbar-thin">
        {report.gates.map((gate) => (
          <li
            key={gate.id}
            className={cn(
              "rounded border border-border/40 px-3 py-2",
              gate.status === "passed" && "border-signal/30",
              gate.status === "failed" && "border-danger/30"
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-foreground">{gate.label}</span>
              <span
                className={cn(
                  "shrink-0 font-mono uppercase",
                  gate.status === "passed" && "text-signal",
                  gate.status === "failed" && "text-danger",
                  gate.status === "not_run" && "text-muted-foreground"
                )}
              >
                {gate.status}
                {gate.requiredForSafePr ? " · req" : ""}
              </span>
            </div>
            {gate.detail && <p className="mt-1 text-muted-foreground">{gate.detail}</p>}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
