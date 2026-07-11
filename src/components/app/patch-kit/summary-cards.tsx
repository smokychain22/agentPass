"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PatchKitSummary } from "@/lib/patch-kit/types";

const cards: {
  key: keyof PatchKitSummary | "lifecycle";
  title: string;
  explanation?: string;
  getValue: (s: PatchKitSummary) => number | string;
}[] = [
  {
    key: "verifiedChanges",
    title: "Retained in workspace",
    explanation:
      "Individual fixes applied in RepoDiet's isolated copy. Your GitHub repository is unchanged until you create a cleanup PR.",
    getValue: (s) => s.verifiedChanges ?? 0,
  },
  {
    key: "validatedChanges",
    title: "Patch-validated changes",
    explanation:
      "Combined cleanup patch passed git apply --check against the scanned commit. Required before Create Cleanup PR.",
    getValue: (s) => s.validatedChanges ?? 0,
  },
  {
    key: "generatedChanges",
    title: "Generated changes",
    explanation: "Non-empty diffs produced in the isolated workspace.",
    getValue: (s) => s.generatedChanges ?? 0,
  },
  {
    key: "attemptedTransformations",
    title: "Attempted",
    explanation: "Transformers invoked against exact scanned source files.",
    getValue: (s) => s.attemptedTransformations ?? 0,
  },
  {
    key: "noopTransformations",
    title: "No-op",
    explanation: "Transformer ran but output equals original — not counted as success.",
    getValue: (s) => s.noopTransformations ?? 0,
  },
  {
    key: "failedTransformations",
    title: "Failed",
    explanation: "Transformer could not safely process the finding.",
    getValue: (s) => s.failedTransformations ?? 0,
  },
  {
    key: "eligibleFindings",
    title: "Eligible findings",
    explanation: "Findings that passed strict preflight with native analyzer evidence.",
    getValue: (s) => s.eligibleFindings ?? s.transformerCompatible ?? 0,
  },
  {
    key: "notAttempted",
    title: "Not attempted",
    explanation: "Eligible findings not processed before the run completed.",
    getValue: (s) => s.notAttempted ?? 0,
  },
];

export function PatchKitSummaryCards({ summary }: { summary: PatchKitSummary }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => {
        const value = card.getValue(summary);
        return (
          <Card key={String(card.key)} className="border-border/80 bg-card/60">
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
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
