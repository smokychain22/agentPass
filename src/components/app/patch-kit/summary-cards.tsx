"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PatchKitSummary } from "@/lib/patch-kit/types";
import { BUNDLE_FILE_COUNT } from "@/lib/patch-kit/bundle-manifest";

const cards: {
  key: keyof PatchKitSummary;
  title: string;
  explanation?: string;
  footnote?: (s: PatchKitSummary) => string | null;
  getValue: (s: PatchKitSummary) => number;
}[] = [
  {
    key: "safeDeleteCandidates",
    title: "Safe candidates",
    explanation: "Unique files eligible for conservative cleanup.patch entries.",
    getValue: (s) => s.safeDeleteCandidates,
  },
  {
    key: "reviewFirstItems",
    title: "Unique review items",
    explanation: "Deduplicated files/packages documented for cleanup review.",
    footnote: (s) =>
      s.rawReviewFindings > s.reviewFirstItems
        ? `Raw review findings: ${s.rawReviewFindings}`
        : null,
    getValue: (s) => s.reviewFirstItems,
  },
  {
    key: "doNotTouchItems",
    title: "Do not touch",
    explanation: "Protected framework, config, route, and runtime files.",
    getValue: (s) => s.doNotTouchItems,
  },
  {
    key: "packageSuggestions",
    title: "Package suggestions",
    explanation: "Unused dependency findings for manual review.",
    getValue: (s) => s.packageSuggestions,
  },
  {
    key: "regressionChecks",
    title: "Regression checks",
    explanation: "Build, route, and API checks in the regression checklist.",
    getValue: (s) => s.regressionChecks,
  },
  {
    key: "bundleFileCount",
    title: "Bundle files",
    explanation: "Artifacts included in the downloadable ZIP bundle.",
    getValue: (s) => s.bundleFileCount ?? BUNDLE_FILE_COUNT,
  },
];

export function PatchKitSummaryCards({ summary }: { summary: PatchKitSummary }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => {
        const value = card.getValue(summary);
        const footnote = card.footnote?.(summary);
        return (
          <Card key={card.key} className="border-border/80 bg-card/60">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {card.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="text-3xl font-semibold tabular-nums tracking-tight">{value}</p>
              {card.explanation && (
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  {card.explanation}
                </p>
              )}
              {footnote && (
                <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-electric/80">
                  {footnote}
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
