"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { FindingsPayload } from "@/lib/findings/types";
import { metricLabel } from "@/lib/findings/stats";

interface SummaryMetric {
  key: string;
  value: number;
  title: string;
  subtitle: string;
  explanation: string;
}

function buildMetrics(payload: FindingsPayload): SummaryMetric[] {
  const { summary, rawToolReports } = payload;
  const dup = metricLabel("duplicates", rawToolReports.jscpd);
  const unused = metricLabel("unusedFiles", rawToolReports.knip);
  const deps = metricLabel("dependencies", rawToolReports.knip);
  const orphans = metricLabel("orphans", rawToolReports.madge);
  const slop = metricLabel("slop");

  return [
    {
      key: "total",
      value: summary.totalFindings,
      title: "Total Findings",
      subtitle: "All normalized findings",
      explanation: "Every finding across duplicates, unused code, orphans, and heuristics.",
    },
    {
      key: "duplicates",
      value: summary.duplicateClusters,
      title: dup.title,
      subtitle: dup.subtitle,
      explanation: "Repeated logic clusters flagged for review before merge.",
    },
    {
      key: "unusedFiles",
      value: summary.unusedFiles,
      title: unused.title,
      subtitle: unused.subtitle,
      explanation: rawToolReports.knip.sourceMode === "fallback"
        ? "Files not reached by the fallback import graph — treat as estimates."
        : "Files not referenced by import graph or framework entry points.",
    },
    {
      key: "dependencies",
      value: summary.unusedDependencies,
      title: deps.title,
      subtitle: deps.subtitle,
      explanation: "Packages listed in package.json without detected imports.",
    },
    {
      key: "orphans",
      value: summary.orphanPatterns,
      title: orphans.title,
      subtitle: orphans.subtitle,
      explanation: "Modules with weak or missing inbound graph connections.",
    },
    {
      key: "slop",
      value: summary.slopSignals,
      title: slop.title,
      subtitle: slop.subtitle,
      explanation: "Backup folders, versioned names, and iteration leftovers.",
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
