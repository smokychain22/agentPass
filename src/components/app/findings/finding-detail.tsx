"use client";

import { X } from "lucide-react";
import type { Finding, FindingsPayload } from "@/lib/findings/types";
import { Panel } from "@/components/design-system/panel";
import { RiskBadge } from "@/components/design-system/risk-badge";
import {
  actionLabel,
  confidenceTierLabel,
  confidenceTierVariant,
  formatFindingAnalyzerLabel,
  measurableEvidenceLines,
  patchPreview,
  severityColor,
  typeLabel,
} from "./findings-utils";
import { CollapsibleFileList } from "@/components/app/ui/collapsible-list";
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

  const gate = finding.evidenceGate;
  const brief = gate?.brief;
  const evidenceLines = measurableEvidenceLines(finding);

  return (
    <Panel variant="elevated" padding="md" className="h-full overflow-y-auto scrollbar-thin">
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
        {finding.confidenceTier && (
          <RiskBadge level={confidenceTierVariant(finding.confidenceTier)}>
            {confidenceTierLabel(finding.confidenceTier)}
          </RiskBadge>
        )}
        <RiskBadge level={bucketLevel}>{actionLabel(finding.action)}</RiskBadge>
        <RiskBadge level="neutral">
          {formatFindingAnalyzerLabel(finding, rawToolReports)}
        </RiskBadge>
        {finding.priorityScore != null && (
          <span className="rounded border border-border/40 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
            Priority {finding.priorityScore.toFixed(2)}
          </span>
        )}
        <span
          className={cn(
            "rounded border border-border/40 px-2 py-0.5 font-mono text-[10px]",
            severityColor(finding.severity)
          )}
        >
          {finding.severity} severity
        </span>
      </div>

      {gate && (
        <div className="mb-4 space-y-2 rounded-md border border-border/50 bg-card/40 p-3">
          <p className="text-xs font-medium text-foreground">Evidence pipeline</p>
          {gate.pipelineStages.map((stage) => (
            <div key={stage.name} className="text-xs">
              <p className={cn(stage.passed ? "text-signal" : "text-amber-400")}>
                {stage.passed ? "✓" : "○"} {stage.label}
              </p>
              <p className="text-muted-foreground pl-4">{stage.summary}</p>
            </div>
          ))}
        </div>
      )}

      <dl className="space-y-4 text-sm">
        <DetailRow label="What was detected?" value={brief?.whatDetected ?? finding.title} />
        <DetailRow
          label="Where is it?"
          value={
            finding.files.length > 0 ? (
              <CollapsibleFileList files={finding.files} />
            ) : (
              <span className="font-mono">{brief?.whereLocated ?? finding.packageName ?? "—"}</span>
            )
          }
        />
        <DetailRow label="Why is it a problem?" value={brief?.whyProblem ?? finding.reason} />
        <DetailRow
          label="Direct evidence"
          value={
            <ul className="space-y-1 text-muted-foreground">
              {(brief?.directEvidence.length ? brief.directEvidence : evidenceLines).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          }
        />
        {brief && brief.contextConsidered.length > 0 && (
          <DetailRow
            label="Repository context considered"
            value={
              <ul className="space-y-1 text-muted-foreground">
                {brief.contextConsidered.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            }
          />
        )}
        {brief && brief.falsePositiveRisks.length > 0 && (
          <DetailRow
            label="What could make this a false positive?"
            value={
              <ul className="space-y-1 text-amber-400/90">
                {brief.falsePositiveRisks.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            }
          />
        )}
        <DetailRow
          label="How confident is RepoDiet?"
          value={brief?.confidenceExplanation ?? finding.evidenceBundle?.decisionReason ?? "—"}
        />
        <DetailRow label="What would change if fixed?" value={brief?.fixImpact ?? patchPreview(finding)} />
        <DetailRow
          label="How will the fix be verified?"
          value={
            <ul className="space-y-1 text-muted-foreground">
              {(brief?.verificationPlan ?? ["review"]).map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
          }
        />
        {finding.deletionProof && (
          <DetailRow
            label="Deletion proof"
            value={
              <ul className="space-y-1 text-xs text-muted-foreground">
                <li>Imports checked: {finding.deletionProof.importsChecked ? "yes" : "no"}</li>
                <li>
                  Dynamic refs checked:{" "}
                  {finding.deletionProof.dynamicReferencesChecked ? "yes" : "no"}
                </li>
                <li>
                  Auto-delete approved:{" "}
                  {finding.deletionProof.approvedForAutomaticDeletion ? "yes" : "no"}
                </li>
              </ul>
            }
          />
        )}
        <DetailRow label="Suggested action" value={patchPreview(finding)} />
        {finding.action === "do_not_touch" && (
          <DetailRow
            label="Protection"
            value={
              finding.protectionReason ??
              "Protected by RepoDiet policy — routes, configs, env files, lockfiles, and API handlers are not auto-deleted."
            }
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
