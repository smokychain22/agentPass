"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PatchKitSummary } from "@/lib/patch-kit/types";
import { BUNDLE_FILE_COUNT } from "@/lib/patch-kit/bundle-manifest";

const cards: {
  key: keyof PatchKitSummary | "detectedSupported";
  title: string;
  explanation?: string;
  footnote?: (s: PatchKitSummary) => string | null;
  getValue: (s: PatchKitSummary) => number;
}[] = [
  {
    key: "detectedSupported",
    title: "Detected supported findings",
    explanation: "Findings with registered transformers (not yet applied).",
    getValue: (s) => s.supportedFixesDetected ?? 0,
  },
  {
    key: "generatedChanges",
    title: "Generated changes",
    explanation: "Patch diffs produced by transformers in this run.",
    getValue: (s) => s.generatedChanges ?? 0,
  },
  {
    key: "validatedChanges",
    title: "Validated changes",
    explanation: "Changes that passed git apply --check in an isolated workspace.",
    getValue: (s) => s.validatedChanges ?? 0,
  },
  {
    key: "verifiedChanges",
    title: "Verified changes",
    explanation: "Changes that passed server verification on the Verify tab.",
    getValue: (s) => s.verifiedChanges ?? 0,
  },
  {
    key: "filesEdited",
    title: "Files edited",
    explanation: "Source files modified by retained transformations.",
    getValue: (s) => s.filesEdited ?? 0,
  },
  {
    key: "safeDeleteCandidates",
    title: "Files deleted",
    explanation: "Conservative delete-only paths (archive/backup style).",
    getValue: (s) => s.filesDeleted ?? s.safeDeleteCandidates,
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
