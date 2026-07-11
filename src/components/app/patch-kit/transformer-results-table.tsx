"use client";

import type { TransformerResult } from "@/lib/patch-kit/types";
import { Panel } from "@/components/design-system/panel";
import { RiskBadge } from "@/components/design-system/risk-badge";
import { CollapsibleTableBody } from "@/components/app/ui/collapsible-list";

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
          <CollapsibleTableBody
            items={results}
            rowKey={(row) => `${row.findingId}-${row.transformer}`}
            renderRow={(row) => (
              <>
                <td className="px-2 py-2 font-mono text-xs align-top">{row.findingId}</td>
                <td className="px-2 py-2 text-xs align-top">{row.transformer}</td>
                <td className="px-2 py-2 align-top">
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
                <td className="px-2 py-2 font-mono text-xs text-muted-foreground align-top">
                  {row.filePath ?? "—"}
                </td>
                <td className="px-2 py-2 text-xs text-muted-foreground align-top">{row.reason}</td>
              </>
            )}
          />
        </table>
      </div>
    </Panel>
  );
}
