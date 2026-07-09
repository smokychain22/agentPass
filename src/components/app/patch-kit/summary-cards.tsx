"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PatchKitSummary } from "@/lib/patch-kit/types";
import { BUNDLE_FILE_COUNT } from "./patch-kit-utils";

const cards: {
  key: keyof PatchKitSummary | "bundleFiles";
  title: string;
  getValue: (s: PatchKitSummary) => number;
}[] = [
  { key: "safeDeleteCandidates", title: "Safe candidates", getValue: (s) => s.safeDeleteCandidates },
  { key: "reviewFirstItems", title: "Review first", getValue: (s) => s.reviewFirstItems },
  { key: "doNotTouchItems", title: "Do not touch", getValue: (s) => s.doNotTouchItems },
  { key: "packageSuggestions", title: "Package suggestions", getValue: (s) => s.packageSuggestions },
  { key: "regressionChecks", title: "Regression checks", getValue: (s) => s.regressionChecks },
  { key: "bundleFiles", title: "Bundle files", getValue: () => BUNDLE_FILE_COUNT },
];

export function PatchKitSummaryCards({ summary }: { summary: PatchKitSummary }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => {
        const value = card.getValue(summary);
        return (
          <Card key={card.key} className="border-border/80 bg-card/60">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {card.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="text-3xl font-semibold tabular-nums tracking-tight">{value}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
