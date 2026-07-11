"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PatchKitSummary } from "@/lib/patch-kit/types";

const cards: {
  key: string;
  title: string;
  explanation?: string;
  getValue: (s: PatchKitSummary) => number | string;
}[] = [
  {
    key: "deliveredFileOperations",
    title: "Delivered file operations",
    explanation: "Validated changes included in an opened cleanup PR.",
    getValue: (s) => s.deliveredFileOperations ?? 0,
  },
  {
    key: "verifiedFileOperations",
    title: "Verified file operations",
    explanation: "Patch applied and repository checks (install, typecheck, build) passed.",
    getValue: (s) => s.verifiedFileOperations ?? s.verifiedChanges ?? 0,
  },
  {
    key: "gitValidatedOperations",
    title: "Git-validated file operations",
    explanation: "Operations that passed real git apply --check on the worker.",
    getValue: (s) => s.gitValidatedOperations ?? s.validatedFileOperations ?? s.validatedChanges ?? 0,
  },
  {
    key: "contentValidatedOperations",
    title: "Content-validated file operations",
    explanation: "Operations whose before/after content integrity passed preflight.",
    getValue: (s) => s.contentValidatedOperations ?? s.generatedFileOperations ?? s.generatedChanges ?? 0,
  },
  {
    key: "generatedFileOperations",
    title: "Generated file operations",
    explanation: "Edit, delete, or add operations produced in the isolated workspace.",
    getValue: (s) => s.generatedFileOperations ?? s.generatedChanges ?? 0,
  },
  {
    key: "executedFindings",
    title: "Executed findings",
    explanation: "Eligible findings that entered transformer execution.",
    getValue: (s) => s.executedFindings ?? s.attemptedTransformations ?? 0,
  },
  {
    key: "eligibleFindings",
    title: "Eligible findings",
    explanation: "Findings that passed strict preflight with native analyzer evidence.",
    getValue: (s) => s.eligibleFindings ?? s.transformerCompatible ?? 0,
  },
  {
    key: "detectedFindings",
    title: "Detected findings",
    explanation: "Evidence-backed signals from native analyzers.",
    getValue: (s) => s.detectedFindings ?? 0,
  },
];

export function PatchKitSummaryCards({ summary }: { summary: PatchKitSummary }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
