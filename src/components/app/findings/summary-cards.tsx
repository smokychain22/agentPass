"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { FindingsSummary } from "@/lib/findings/types";

const cards: {
  key: keyof FindingsSummary;
  title: string;
  explanation: string;
  status: (n: number) => string;
}[] = [
  {
    key: "duplicateClusters",
    title: "Duplicate Clusters",
    explanation: "Repeated logic detected across components and utilities.",
    status: (n) => (n > 0 ? "jscpd clusters mapped" : "No duplicate clusters detected"),
  },
  {
    key: "unusedFiles",
    title: "Unused Files",
    explanation: "Files not reached by import graph or entry points.",
    status: (n) => (n > 0 ? "Knip + graph analysis" : "No unused files flagged"),
  },
  {
    key: "unusedDependencies",
    title: "Unused Dependencies",
    explanation: "Packages listed but not imported in source.",
    status: (n) => (n > 0 ? "package.json audit" : "Dependencies look referenced"),
  },
  {
    key: "orphanPatterns",
    title: "Orphan Patterns",
    explanation: "Disconnected modules and circular dependency islands.",
    status: (n) => (n > 0 ? "Madge graph analysis" : "No orphan islands detected"),
  },
  {
    key: "slopSignals",
    title: "AI-Slop Signals",
    explanation: "Versioned names, backup folders, and iteration leftovers.",
    status: (n) => (n > 0 ? "Heuristic scan active" : "No slop patterns flagged"),
  },
  {
    key: "reviewRequired",
    title: "Review Required",
    explanation: "Findings that need human or agent review before patching.",
    status: (n) => `${n} item${n === 1 ? "" : "s"} in review queue`,
  },
];

export function SummaryCards({ summary }: { summary: FindingsSummary }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => {
        const value = summary[card.key];
        return (
          <Card key={card.key} className="border-border/80 bg-card/60">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {card.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="text-3xl font-semibold tabular-nums tracking-tight">{value}</p>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                {card.explanation}
              </p>
              <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-electric/80">
                {card.status(value)}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
