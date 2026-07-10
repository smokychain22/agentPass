"use client";

import { X } from "lucide-react";
import type { Finding, FindingsPayload } from "@/lib/findings/types";
import { Panel } from "@/components/design-system/panel";
import { RiskBadge } from "@/components/design-system/risk-badge";
import {
  actionLabel,
  formatFindingAnalyzerLabel,
  measurableEvidenceLines,
  patchPreview,
  severityColor,
  typeLabel,
} from "./findings-utils";
import { cn } from "@/lib/utils";

interface FindingDetailProps {
  finding: Finding;
  rawToolReports?: FindingsPayload["rawToolReports"];
  onClose?: () => void;
}

export function FindingDetail({ finding, rawToolReports, onClose }: FindingDetailProps) {
  const bucketLevel =
    finding.action === "safe_candidate"
      ? "safe"
      : finding.action === "do_not_touch"
        ? "protected"
        : "review";

  const evidenceLines = measurableEvidenceLines(finding);

  return (
    <Panel variant="elevated" padding="md" className="h-full">
      <div className="mb-4 flex items-start justify-between gap-2">
        <div>
          <p className="ds-label">{typeLabel(finding.type)}</p>
          <h3 className="mt-1 text-base font-semibold text-foreground">{finding.title}</h3>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md border border-border/60 p-1.5"
            aria-label="Close detail"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <RiskBadge level={bucketLevel}>{actionLabel(finding.action)}</RiskBadge>
        <RiskBadge level="neutral">
          {formatFindingAnalyzerLabel(finding, rawToolReports)}
        </RiskBadge>
        <span className={cn("rounded border border-border/40 px-2 py-0.5 font-mono text-[10px]", severityColor(finding.severity))}>
          {finding.severity} severity
        </span>
      </div>

      <dl className="space-y-4 text-sm">
        <DetailRow label="Reason" value={finding.reason} />
        <DetailRow
          label="Evidence"
          value={
            <ul className="space-y-1 text-muted-foreground">
              {evidenceLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          }
        />
        <DetailRow
          label="Affected files"
          value={
            finding.files.length > 0 ? (
              <ul className="space-y-0.5 font-mono text-xs text-muted-foreground">
                {finding.files.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            ) : (
              finding.packageName ?? "—"
            )
          }
        />
        {finding.packageName && (
          <DetailRow label="Package" value={<span className="font-mono">{finding.packageName}</span>} />
        )}
        <DetailRow label="Suggested action" value={patchPreview(finding)} />
        {finding.action === "do_not_touch" && (
          <DetailRow
            label="Protection"
            value="Protected by RepoDiet policy — routes, configs, env files, lockfiles, and API handlers are not auto-deleted."
          />
        )}
      </dl>
    </Panel>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="ds-label mb-1">{label}</dt>
      <dd className="leading-relaxed text-muted-foreground">{value}</dd>
    </div>
  );
}
