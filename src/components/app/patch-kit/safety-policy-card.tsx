"use client";

import { Shield } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const POLICIES = [
  "RepoDiet never auto-deletes your repo.",
  "Only Safe Candidate findings enter cleanup.patch.",
  "Review First items are documented, not patched.",
  "Do Not Touch files are protected.",
];

export function SafetyPolicyCard() {
  return (
    <Card className="border-signal/20 bg-signal/5">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Shield className="h-4 w-4 text-signal" />
          Safety Policy
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 text-sm text-muted-foreground leading-relaxed">
          {POLICIES.map((policy) => (
            <li key={policy} className="flex items-start gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-signal" />
              {policy}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
