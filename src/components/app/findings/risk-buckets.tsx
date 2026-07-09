"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { FindingsPayload } from "@/lib/findings/types";

const buckets = [
  {
    key: "safeDelete" as const,
    title: "Safe Candidates",
    description: "Files likely removable after verification.",
    accent: "border-signal/30 bg-signal/5",
    titleColor: "text-signal",
  },
  {
    key: "reviewFirst" as const,
    title: "Review First",
    description: "Needs human or agent review before patching.",
    accent: "border-electric/30 bg-electric/5",
    titleColor: "text-electric",
  },
  {
    key: "doNotTouch" as const,
    title: "Do Not Touch",
    description: "Framework/config/runtime files protected by RepoDiet.",
    accent: "border-border bg-muted/20",
    titleColor: "text-foreground",
  },
];

export function RiskBuckets({ findings }: { findings: FindingsPayload }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {buckets.map((bucket) => {
        const count = findings.riskBuckets[bucket.key].length;
        return (
          <Card key={bucket.key} className={`border ${bucket.accent}`}>
            <CardHeader className="pb-2">
              <CardTitle className={`text-base font-semibold ${bucket.titleColor}`}>
                {bucket.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-4xl font-semibold tabular-nums">{count}</p>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                {bucket.description}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
