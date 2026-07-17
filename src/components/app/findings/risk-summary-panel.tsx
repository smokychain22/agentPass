"use client";

import { Panel } from "@/components/design-system/panel";
import { RiskBadge } from "@/components/design-system/risk-badge";
import type { FindingsSummary } from "@/lib/findings/types";

export function RiskSummaryPanel({ summary }: { summary: FindingsSummary }) {
  const rows = [
    {
      label: "Verified findings",
      value: summary.verifiedFindings ?? summary.totalFindings,
      level: "review" as const,
      hint: "Only findings from successful native analyzers",
    },
    {
      label: "Eligible for cleanup",
      value: summary.eligibleFindings ?? 0,
      level: "neutral" as const,
      hint: "Canonical preflight: SAFE + transformer produced a real content change",
    },
    {
      label: "Transformed",
      value: summary.transformedFindings ?? summary.dryRunPassed ?? 0,
      level: "safe" as const,
      hint: "Source modifications confirmed at scan time — not no-ops",
    },
    {
      label: "Review required",
      value: summary.reviewRequiredFindings ?? summary.reviewRequired,
      level: "review" as const,
      hint: "Needs human review — not eligible for automatic cleanup",
    },
    {
      label: "Protected",
      value: summary.protectedFindings ?? summary.doNotTouch,
      level: "protected" as const,
      hint: "Routes, configs, lockfiles — automatic deletion forbidden",
    },
  ];

  return (
    <Panel variant="elevated" padding="md">
      <p className="ds-label mb-3">Evidence classification</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {rows.map((row) => (
          <div key={row.label} className="rounded border border-border/40 bg-card/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <RiskBadge level={row.level}>{row.label}</RiskBadge>
              <span className="text-2xl font-semibold tabular-nums">{row.value}</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{row.hint}</p>
          </div>
        ))}
      </div>
    </Panel>
  );
}
