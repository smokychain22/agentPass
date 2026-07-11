"use client";

import type { CandidateAuditRecord } from "@/lib/execution/candidate-lifecycle";
import { Panel } from "@/components/design-system/panel";
import { RiskBadge } from "@/components/design-system/risk-badge";
import { CollapsibleTableBody } from "@/components/app/ui/collapsible-list";

function executionLabel(row: CandidateAuditRecord): { level: "safe" | "review" | "neutral"; text: string } {
  if (row.retained && row.patchValidated) return { level: "safe", text: "verified" };
  if (row.retained || row.contentChanged || row.proposedSourceChanged || row.proposedDiffGenerated) {
    return { level: "safe", text: "generated" };
  }
  if (row.transformAttempted) {
    if (row.blockerCode === "transform_noop") return { level: "review", text: "no-op" };
    if (row.blockerCode === "diff_generation_failed") return { level: "review", text: "diff failed" };
    return { level: "review", text: "failed" };
  }
  if (row.blockerCode === "not_attempted") return { level: "neutral", text: "skipped (limit)" };
  if (row.scanEligible) return { level: "neutral", text: "eligible" };
  return { level: "review", text: "ineligible" };
}

export function CandidateAuditTable({ audits }: { audits: CandidateAuditRecord[] }) {
  if (!audits.length) return null;

  return (
    <Panel variant="elevated" padding="md">
      <p className="ds-label mb-3">Candidate attempt history</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border/60 text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-2 py-2 font-medium">Finding</th>
              <th className="px-2 py-2 font-medium">Type</th>
              <th className="px-2 py-2 font-medium">Plugin</th>
              <th className="px-2 py-2 font-medium">Eligible</th>
              <th className="px-2 py-2 font-medium">Execution</th>
              <th className="px-2 py-2 font-medium">Retained</th>
              <th className="px-2 py-2 font-medium">Blocker</th>
            </tr>
          </thead>
          <CollapsibleTableBody
            items={audits}
            rowKey={(row) => row.findingId}
            renderRow={(row) => {
              const execution = executionLabel(row);
              return (
                <>
                  <td className="px-2 py-2 font-mono text-xs align-top">
                    <div>{row.findingId}</div>
                    {row.filePath && (
                      <div className="text-muted-foreground">{row.filePath}</div>
                    )}
                  </td>
                  <td className="px-2 py-2 text-xs align-top">{row.findingType}</td>
                  <td className="px-2 py-2 text-xs align-top">{row.pluginId}</td>
                  <td className="px-2 py-2 align-top">
                    <RiskBadge level={row.scanEligible ? "safe" : "review"}>
                      {row.scanEligible ? "yes" : "no"}
                    </RiskBadge>
                  </td>
                  <td className="px-2 py-2 align-top">
                    <RiskBadge level={execution.level}>{execution.text}</RiskBadge>
                  </td>
                  <td className="px-2 py-2 align-top">
                    <RiskBadge level={row.retained ? "safe" : "neutral"}>
                      {row.retained ? "yes" : "no"}
                    </RiskBadge>
                  </td>
                  <td className="px-2 py-2 text-xs text-muted-foreground align-top">
                    {row.retained
                      ? "—"
                      : row.blockerCode
                        ? `${row.blockerCode.replace(/_/g, " ")}${row.blockerMessage ? `: ${row.blockerMessage}` : ""}`
                        : "—"}
                  </td>
                </>
              );
            }}
          />
        </table>
      </div>
    </Panel>
  );
}
