"use client";

import { useState } from "react";
import { Check, FileText } from "lucide-react";
import { ARTIFACT_PREVIEWS, DEMO_SCAN_STATS } from "@/lib/marketing/content";
import { Panel } from "@/components/design-system/panel";
import { RiskBadge } from "@/components/design-system/risk-badge";
import { cn } from "@/lib/utils";

const DISPLAY_ARTIFACTS = ARTIFACT_PREVIEWS.filter(
  (a) => a.filename !== "patchkit-summary.json"
);

export function PatchBundleWorkspace() {
  const [selected, setSelected] = useState(DISPLAY_ARTIFACTS[0].filename);

  const artifact = DISPLAY_ARTIFACTS.find((a) => a.filename === selected)!;

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr_240px]">
      {/* Navigator */}
      <Panel variant="elevated" padding="sm" className="lg:max-h-[420px] lg:overflow-y-auto scrollbar-thin">
        <p className="ds-label mb-3">Artifact navigator</p>
        <nav aria-label="Patch bundle artifacts">
          <ul className="space-y-1">
            {DISPLAY_ARTIFACTS.map((item) => {
              const isActive = selected === item.filename;
              return (
                <li key={item.filename}>
                  <button
                    type="button"
                    onClick={() => setSelected(item.filename)}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors",
                      isActive
                        ? "border-electric/40 bg-electric/10"
                        : "border-transparent hover:border-border/60 hover:bg-card"
                    )}
                    aria-current={isActive ? "true" : undefined}
                  >
                    <FileText
                      className={cn(
                        "mt-0.5 h-3.5 w-3.5 shrink-0",
                        isActive ? "text-electric" : "text-muted-foreground"
                      )}
                      aria-hidden
                    />
                    <span className="font-mono text-[10px] leading-tight text-foreground">
                      {item.filename}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </Panel>

      {/* Preview */}
      <Panel variant="code" padding="none" className="min-h-[280px] overflow-hidden">
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
          <p className="font-mono text-xs text-foreground">{artifact.filename}</p>
          <p className="text-[10px] text-muted-foreground">{artifact.purpose}</p>
        </div>
        <pre className="max-h-[340px] overflow-auto p-4 font-mono text-[11px] leading-relaxed text-muted-foreground scrollbar-thin">
          {artifact.preview}
        </pre>
      </Panel>

      {/* Summary */}
      <Panel variant="elevated" padding="sm">
        <p className="ds-label mb-3">Bundle summary</p>
        <dl className="space-y-3">
          <SummaryRow label="Artifact count" value="7" />
          <SummaryRow label="Safe candidates" value={String(DEMO_SCAN_STATS.safeCandidates)} level="safe" />
          <SummaryRow label="Review-first" value={String(DEMO_SCAN_STATS.reviewFirst)} level="review" />
          <SummaryRow label="Protected files" value={String(DEMO_SCAN_STATS.doNotTouch)} level="protected" />
        </dl>
        <div className="mt-4 rounded border border-signal/25 bg-signal/5 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Check className="h-3.5 w-3.5 text-signal" aria-hidden />
            <span className="text-xs font-medium text-signal">Verification readiness</span>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Regression checklist included · review before merge
          </p>
        </div>
      </Panel>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  level,
}: {
  label: string;
  value: string;
  level?: "safe" | "review" | "protected";
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>
        {level ? (
          <RiskBadge level={level}>{value}</RiskBadge>
        ) : (
          <span className="font-mono text-sm font-semibold text-foreground">{value}</span>
        )}
      </dd>
    </div>
  );
}
