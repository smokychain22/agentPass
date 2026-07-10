"use client";

import { Panel } from "@/components/design-system/panel";
import { RiskBadge } from "@/components/design-system/risk-badge";
import type { FindingsSummary } from "@/lib/findings/types";

export function RiskSummaryPanel({ summary }: { summary: FindingsSummary }) {
  const rows = [
    {
      label: "Safe candidates",
      value: summary.safeCandidates,
      level: "safe" as const,
      hint: "High-confidence conservative cleanup targets",
    },
    {
      label: "Review first",
      value: summary.reviewRequired,
      level: "review" as const,
      hint: "Needs human review before any deletion",
    },
    {
      label: "Protected",
      value: summary.doNotTouch,
      level: "protected" as const,
      hint: "Routes, configs, and framework entry points",
    },
  ];

  return (
    <Panel variant="elevated" padding="md">
      <p className="ds-label mb-3">Risk classification</p>
      <div className="grid gap-3 sm:grid-cols-3">
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
      <p className="mt-3 font-mono text-[10px] text-muted-foreground">
        Total findings: {summary.totalFindings} = review ({summary.reviewRequired}) + safe (
        {summary.safeCandidates}) + protected ({summary.doNotTouch})
      </p>
    </Panel>
  );
}
