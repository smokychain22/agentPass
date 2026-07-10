"use client";

import type { TransformerResult } from "@/lib/patch-kit/types";
import { Panel } from "@/components/design-system/panel";
import { RiskBadge } from "@/components/design-system/risk-badge";

export function TransformerResultsTable({ results }: { results: TransformerResult[] }) {
  if (!results.length) return null;

  return (
    <Panel variant="elevated" padding="md">
      <p className="ds-label mb-3">Transformer results</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border/60 text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-2 py-2 font-medium">Finding</th>
              <th className="px-2 py-2 font-medium">Transformer</th>
              <th className="px-2 py-2 font-medium">Status</th>
              <th className="px-2 py-2 font-medium">File</th>
              <th className="px-2 py-2 font-medium">Reason</th>
            </tr>
          </thead>
          <tbody>
            {results.map((row) => (
              <tr key={row.findingId} className="border-b border-border/40 align-top">
                <td className="px-2 py-2 font-mono text-xs">{row.findingId}</td>
                <td className="px-2 py-2 text-xs">{row.transformer}</td>
                <td className="px-2 py-2">
                  <RiskBadge
                    level={
                      row.status === "generated"
                        ? "safe"
                        : row.status === "failed"
                          ? "review"
                          : "neutral"
                    }
                  >
                    {row.status}
                  </RiskBadge>
                </td>
                <td className="px-2 py-2 font-mono text-xs text-muted-foreground">
                  {row.filePath ?? "—"}
                </td>
                <td className="px-2 py-2 text-xs text-muted-foreground">{row.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
