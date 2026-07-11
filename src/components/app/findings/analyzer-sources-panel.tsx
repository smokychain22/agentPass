"use client";

import { Panel } from "@/components/design-system/panel";
import type { FindingsPayload } from "@/lib/findings/types";
import { analyzerSourceLabel } from "@/lib/findings/stats";

const ROWS: { key: keyof FindingsPayload["rawToolReports"]; label: string }[] = [
  { key: "jscpd", label: "Duplicate detection" },
  { key: "knip", label: "Unused-code analysis" },
  { key: "madge", label: "Dependency graph" },
];

export function AnalyzerSourcesPanel({ payload }: { payload: FindingsPayload }) {
  return (
    <Panel variant="elevated" padding="md">
      <p className="ds-label mb-3">Analysis sources</p>
      <div className="space-y-3">
        {ROWS.map(({ key, label }) => {
          const report = payload.rawToolReports[key];
          const source = analyzerSourceLabel(report);
          return (
            <div
              key={key}
              className="flex flex-wrap items-start justify-between gap-2 border-b border-border/30 pb-3 last:border-0 last:pb-0"
            >
              <div>
                <p className="text-sm font-medium">{label}</p>
                <p className="font-mono text-[10px] text-muted-foreground">{source.name}</p>
              </div>
              <div className="text-right">
                <span
                  className={
                    source.mode === "Native"
                      ? "text-signal font-mono text-[10px] uppercase"
                      : source.mode === "Fallback"
                        ? "text-amber-400 font-mono text-[10px] uppercase"
                        : "text-danger font-mono text-[10px] uppercase"
                  }
                >
                  {source.mode}
                </span>
                <p className="mt-1 max-w-xs text-[10px] text-muted-foreground">{source.detail}</p>
              </div>
            </div>
          );
        })}
        <div className="flex flex-wrap items-start justify-between gap-2 border-t border-border/30 pt-3">
          <div>
            <p className="text-sm font-medium">AI-slop heuristics</p>
            <p className="font-mono text-[10px] text-muted-foreground">Internal heuristic engine</p>
          </div>
          <span className="text-signal font-mono text-[10px] uppercase">Native</span>
        </div>
      </div>
    </Panel>
  );
}
