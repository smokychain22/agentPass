"use client";

import { Panel } from "@/components/design-system/panel";
import { RiskBadge } from "@/components/design-system/risk-badge";
import type { FindingsSummary } from "@/lib/findings/types";

export function RiskSummaryPanel({ summary }: { summary: FindingsSummary }) {
  const rows = [
    {
      label: "Detected",
      value: summary.detectedFindings ?? summary.totalFindings,
      level: "review" as const,
      hint: "Signals from analyzers and heuristics — not yet transformed",
    },
    {
      label: "Detected supported findings",
      value: summary.supportedFixes ?? summary.actionableFixes ?? 0,
      level: "safe" as const,
      hint: "Findings with a registered transformer — not yet generated or validated",
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
      <p className="ds-label mb-3">Risk classification</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
        Lifecycle: detected ({summary.detectedFindings ?? summary.totalFindings}) → supported (
        {summary.supportedFixes ?? summary.actionableFixes ?? 0}) · review (
        {summary.reviewRequiredFindings ?? summary.reviewRequired}) · protected (
        {summary.protectedFindings ?? summary.doNotTouch})
      </p>
    </Panel>
  );
}
