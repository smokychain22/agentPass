"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { FindingsPayload } from "@/lib/findings/types";
import { availabilityLabel, unavailableMessage } from "@/lib/findings/analyzer-availability";
import { flattenFindings } from "@/lib/findings/client";

interface SummaryMetric {
  key: string;
  value: number | string;
  title: string;
  subtitle: string;
  explanation: string;
}

function buildMetrics(payload: FindingsPayload): SummaryMetric[] {
  const { summary, analyzerStates } = payload;
  const flat = flattenFindings(payload);
  const jscpdState = analyzerStates?.jscpd;
  const knipState = analyzerStates?.knip;
  const madgeState = analyzerStates?.madge;

  const dupAvailable = jscpdState?.status === "available";
  const knipAvailable = knipState?.status === "available";
  const madgeAvailable = madgeState?.status === "available";

  const duplicateCount = flat.filter((f) => f.type === "duplicate_code").length;
  const unusedCodeCount = flat.filter(
    (f) =>
      f.type === "unused_file" ||
      f.type === "unused_dependency" ||
      f.type === "unused_export" ||
      f.type === "unused_import"
  ).length;
  const orphanCount = flat.filter((f) => f.type === "orphan_pattern").length;
  const slopCount = flat.filter((f) => f.type === "ai_slop_signal").length;
  const verifiedCount = flat.filter(
    (f) => f.confidenceTier === "verified" || f.sourceMode === "native"
  ).length;

  return [
    {
      key: "verified",
      value: summary.verifiedFindings ?? verifiedCount,
      title: "Verified findings",
      subtitle: "Successful analyzers only",
      explanation: "Counts only findings from analyzers that ran natively. Fallback estimates are excluded.",
    },
    {
      key: "duplicates",
      value: dupAvailable ? duplicateCount : "Unavailable",
      title: "Duplicate analysis",
      subtitle: dupAvailable
        ? `jscpd${jscpdState?.version ? ` v${jscpdState.version}` : ""}`
        : "Unavailable",
      explanation: dupAvailable
        ? "Duplicate clusters from native jscpd analysis."
        : unavailableMessage("jscpd"),
    },
    {
      key: "unused",
      value: knipAvailable ? unusedCodeCount : "Unavailable",
      title: "Unused-code analysis",
      subtitle: knipAvailable
        ? `Knip${knipState?.version ? ` v${knipState.version}` : ""}`
        : "Unavailable",
      explanation: knipAvailable
        ? "Unused files, dependencies, exports, and imports from native Knip + RepoDiet import analyzer."
        : unavailableMessage("knip"),
    },
    {
      key: "orphans",
      value: madgeAvailable ? orphanCount : "Unavailable",
      title: "Dependency graph",
      subtitle: madgeAvailable
        ? `Madge${madgeState?.version ? ` v${madgeState.version}` : ""}`
        : "Unavailable",
      explanation: madgeAvailable
        ? "Orphan modules from native Madge dependency graph."
        : unavailableMessage("madge"),
    },
    {
      key: "slop",
      value: slopCount,
      title: "AI-slop signals",
      subtitle: analyzerStates?.heuristics
        ? availabilityLabel(analyzerStates.heuristics)
        : "RepoDiet heuristics",
      explanation: "Backup folders, versioned names, and iteration leftovers from RepoDiet heuristics.",
    },
    {
      key: "eligible",
      value: summary.eligibleFindings ?? summary.actionableFixes ?? 0,
      title: "Cleanup-eligible",
      subtitle: "Preflight-confirmed",
      explanation: "Findings with native evidence and a transformer preflight that produced a real content change.",
    },
  ];
}

export function SummaryCards({ payload }: { payload: FindingsPayload }) {
  const metrics = buildMetrics(payload);

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {metrics.map((card) => (
        <Card key={card.key} className="border-border/80 bg-card/60">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {card.title}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-3xl font-semibold tabular-nums tracking-tight">{card.value}</p>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{card.explanation}</p>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-electric/80">
              {card.subtitle}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
