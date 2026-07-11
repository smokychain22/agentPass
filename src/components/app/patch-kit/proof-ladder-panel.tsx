"use client";

import { Panel } from "@/components/design-system/panel";
import type { ProofLadderCounts } from "@/lib/execution/proof-ladder";
import { formatProofLadderSummary } from "@/lib/execution/proof-ladder";
import { cn } from "@/lib/utils";

const STAGES: {
  key: keyof ProofLadderCounts;
  label: string;
  description: string;
}[] = [
  { key: "detected", label: "Detected", description: "Evidence-backed signals from native analyzers" },
  { key: "eligible", label: "Eligible", description: "Supported by a deterministic transformer" },
  { key: "executed", label: "Executed findings", description: "Eligible findings that entered transformer execution" },
  { key: "generated", label: "Generated file operations", description: "Non-empty source modifications produced" },
  { key: "validated", label: "Validated file operations", description: "Patch passed git apply --check --index" },
  { key: "verified", label: "Verified file operations", description: "Repository checks passed on patched copy" },
  { key: "delivered", label: "Delivered file operations", description: "Cleanup PR opened on review branch" },
];

export function ProofLadderPanel({
  ladder,
  className,
}: {
  ladder: ProofLadderCounts;
  className?: string;
}) {
  const maxStage = STAGES.map((s) => {
    const key = s.key === "executed" ? ("executed" as keyof ProofLadderCounts) : s.key;
    const value = ladder[key] ?? (key === "executed" ? ladder.attempted : 0);
    return typeof value === "number" ? value : 0;
  }).reduce((a, b) => Math.max(a, b), 1);

  return (
    <Panel variant="elevated" padding="md" className={className}>
      <p className="ds-label mb-1">Proof ladder</p>
      <p className="mb-4 text-sm text-muted-foreground leading-relaxed">
        Every number comes from backend execution — not scan-time estimates. RepoDiet acts only when
        a stage produces real evidence.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STAGES.map((stage) => {
          const value =
            stage.key === "executed"
              ? (ladder.executed ?? ladder.attempted)
              : ladder[stage.key];
          const active = value > 0;
          return (
            <div
              key={stage.key}
              className={cn(
                "rounded-md border px-3 py-3",
                active ? "border-signal/40 bg-signal/5" : "border-border/60 bg-card/40"
              )}
            >
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{stage.label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
              <div className="mt-2 h-1 rounded-full bg-border/60 overflow-hidden">
                <div
                  className={cn("h-full rounded-full", active ? "bg-signal" : "bg-transparent")}
                  style={{ width: `${Math.min(100, (value / maxStage) * 100)}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{stage.description}</p>
            </div>
          );
        })}
      </div>
      {(ladder.noop > 0 || ladder.failed > 0 || ladder.notAttempted > 0) && (
        <p className="mt-4 font-mono text-xs text-muted-foreground">
          {formatProofLadderSummary(ladder)}
        </p>
      )}
    </Panel>
  );
}
