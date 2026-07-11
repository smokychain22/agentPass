"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Finding, FindingsPayload } from "@/lib/findings/types";
import { CollapsibleFileList } from "@/components/app/ui/collapsible-list";
import { actionLabel, actionVariant } from "./findings-utils";

function PanelItem({ finding, extra }: { finding: Finding; extra?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border/80 bg-muted/10 px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-medium">{finding.title}</p>
        <Badge variant={actionVariant(finding.action)} className="text-[10px] shrink-0">
          {actionLabel(finding.action)}
        </Badge>
      </div>
      <CollapsibleFileList files={finding.files} className="mt-2" />
      <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{finding.reason}</p>
      {extra}
      <p className="mt-2 font-mono text-[10px] text-muted-foreground">
        {Math.round(finding.confidence * 100)}% · {finding.source}
      </p>
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section>
      <h3 className="text-sm font-medium uppercase tracking-wider text-muted-foreground mb-3">
        {title}{" "}
        <span className="text-foreground font-mono normal-case">({count})</span>
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function CategoryPanels({ payload }: { payload: FindingsPayload }) {
  return (
    <div className="space-y-8">
      <Section title="Duplicate Clusters" count={payload.duplicates.length}>
        {payload.duplicates.map((f) => (
          <PanelItem
            key={f.id}
            finding={f}
            extra={
              f.lines ? (
                <p className="mt-1 font-mono text-[10px] text-electric">
                  Lines {f.lines.start}–{f.lines.end} · source: jscpd
                </p>
              ) : (
                <p className="mt-1 font-mono text-[10px] text-electric">source: jscpd</p>
              )
            }
          />
        ))}
      </Section>

      <Section
        title="Unused Files"
        count={payload.unused.files.length + payload.unused.exports.length}
      >
        {[...payload.unused.files, ...payload.unused.exports].map((f) => (
          <PanelItem
            key={f.id}
            finding={f}
            extra={
              <p className="mt-1 text-[10px] text-muted-foreground">
                {f.action === "do_not_touch" ? "Protected route/framework file" : "Review import graph"}
              </p>
            }
          />
        ))}
      </Section>

      <Section title="Unused Dependencies" count={payload.unused.dependencies.length}>
        {payload.unused.dependencies.map((f) => (
          <PanelItem
            key={f.id}
            finding={f}
            extra={
              f.packageName && (
                <p className="mt-1 font-mono text-xs text-electric">{f.packageName}</p>
              )
            }
          />
        ))}
      </Section>

      <Section title="Orphan Patterns" count={payload.orphans.length}>
        {payload.orphans.map((f) => (
          <PanelItem
            key={f.id}
            finding={f}
            extra={
              <p className="mt-1 text-[10px] text-muted-foreground">
                Graph island · risk: {f.severity}
              </p>
            }
          />
        ))}
      </Section>

      <Section title="AI-Slop Signals" count={payload.slopSignals.length}>
        {payload.slopSignals.map((f) => (
          <PanelItem
            key={f.id}
            finding={f}
            extra={
              <p className="mt-1 text-[10px] text-muted-foreground">
                AI-era heuristic · recommended: {actionLabel(f.action)}
              </p>
            }
          />
        ))}
      </Section>
    </div>
  );
}
