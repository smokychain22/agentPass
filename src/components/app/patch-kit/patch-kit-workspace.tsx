"use client";

import { useState } from "react";
import { Copy, Download, FileText } from "lucide-react";
import type { PatchKitArtifacts, PatchKitSummary } from "@/lib/patch-kit/types";
import { Panel } from "@/components/design-system/panel";
import { RiskBadge } from "@/components/design-system/risk-badge";
import { Button } from "@/components/ui/button";
import { DiffViewer } from "./diff-viewer";
import { ARTIFACT_DEFINITIONS } from "./patch-kit-utils";
import { cn } from "@/lib/utils";

interface PatchKitWorkspaceProps {
  artifacts: PatchKitArtifacts;
  summary: PatchKitSummary;
  onCopy: (text: string, label: string) => void;
  onDownload: () => void;
}

export function PatchKitWorkspace({
  artifacts,
  summary,
  onCopy,
  onDownload,
}: PatchKitWorkspaceProps) {
  const [selected, setSelected] = useState(ARTIFACT_DEFINITIONS[0].id);

  const artifact = ARTIFACT_DEFINITIONS.find((a) => a.id === selected)!;
  const content = artifact.getContent(artifacts);
  const isPatch = artifact.id === "patch";

  return (
    <div className="space-y-4">
      <Panel variant="cyan" padding="sm" className="flex items-start gap-3">
        <p className="text-sm text-muted-foreground">
          <strong className="text-foreground">RepoDiet does not apply this patch automatically.</strong>{" "}
          Review all artifacts before merging any cleanup changes.
        </p>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-[220px_1fr_240px]">
        {/* Navigator */}
        <Panel variant="elevated" padding="sm" className="lg:max-h-[520px] lg:overflow-y-auto scrollbar-thin">
          <p className="ds-label mb-3">Artifacts</p>
          <nav aria-label="Patch kit artifacts">
            <ul className="space-y-1">
              {ARTIFACT_DEFINITIONS.map((item) => {
                const active = selected === item.id;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(item.id)}
                      className={cn(
                        "flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors",
                        active
                          ? "border-electric/40 bg-electric/10"
                          : "border-transparent hover:border-border/60 hover:bg-card"
                      )}
                      aria-current={active ? "true" : undefined}
                    >
                      <FileText
                        className={cn(
                          "mt-0.5 h-3.5 w-3.5 shrink-0",
                          active ? "text-electric" : "text-muted-foreground"
                        )}
                        aria-hidden
                      />
                      <div>
                        <p className="font-mono text-[10px] text-foreground">{item.filename}</p>
                        <p className="mt-0.5 text-[9px] text-muted-foreground">{item.description}</p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        </Panel>

        {/* Preview */}
        <Panel variant="code" padding="none" className="min-h-[320px] overflow-hidden">
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
            <p className="font-mono text-xs text-foreground">{artifact.filename}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onCopy(content, artifact.filename)}
            >
              <Copy className="h-3.5 w-3.5" aria-hidden />
              Copy
            </Button>
          </div>
          {isPatch ? (
            <DiffViewer content={content} className="max-h-[440px]" />
          ) : (
            <pre className="max-h-[440px] overflow-auto p-4 font-mono text-[11px] leading-relaxed text-muted-foreground scrollbar-thin">
              {content}
            </pre>
          )}
        </Panel>

        {/* Summary */}
        <Panel variant="elevated" padding="sm">
          <p className="ds-label mb-3">Bundle summary</p>
          <dl className="space-y-3 text-sm">
            <SummaryRow label="Artifacts" value={String(summary.bundleFileCount)} />
            <SummaryRow label="Safe candidates" value={String(summary.safeDeleteCandidates)} level="safe" />
            <SummaryRow label="Review-first" value={String(summary.reviewFirstItems)} level="review" />
            <SummaryRow label="Protected files" value={String(summary.doNotTouchItems)} level="protected" />
            <SummaryRow label="Regression checks" value={String(summary.regressionChecks)} level="cyan" />
          </dl>

          <div className="mt-5 space-y-2">
            <Button className="w-full" onClick={onDownload}>
              <Download className="h-4 w-4" aria-hidden />
              Download Bundle
            </Button>
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => onCopy(artifacts.cursorPromptMd, "Cursor prompt")}
            >
              <Copy className="h-4 w-4" aria-hidden />
              Copy Cursor Prompt
            </Button>
          </div>
        </Panel>
      </div>
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
  level?: "safe" | "review" | "protected" | "cyan";
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>
        {level ? (
          <RiskBadge level={level}>{value}</RiskBadge>
        ) : (
          <span className="font-mono font-semibold text-foreground">{value}</span>
        )}
      </dd>
    </div>
  );
}
