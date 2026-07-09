"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Finding, FindingAction, FindingType } from "@/lib/findings/types";
import {
  actionLabel,
  actionVariant,
  confidenceExplanation,
  findingTarget,
  patchPreview,
  severityColor,
  sourceLabel,
  typeLabel,
} from "./findings-utils";
import { cn } from "@/lib/utils";

type FilterKey =
  | "all"
  | "duplicates"
  | "unused_files"
  | "dependencies"
  | "orphans"
  | "slop"
  | "safe_candidate"
  | "review_first"
  | "do_not_touch";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "duplicates", label: "Duplicates" },
  { key: "unused_files", label: "Unused Files" },
  { key: "dependencies", label: "Dependencies" },
  { key: "orphans", label: "Orphans" },
  { key: "slop", label: "AI Slop" },
  { key: "safe_candidate", label: "Safe Candidate" },
  { key: "review_first", label: "Review First" },
  { key: "do_not_touch", label: "Do Not Touch" },
];

function matchesFilter(finding: Finding, filter: FilterKey): boolean {
  if (filter === "all") return true;
  if (filter === "duplicates") return finding.type === "duplicate_code";
  if (filter === "unused_files")
    return finding.type === "unused_file" || finding.type === "unused_export";
  if (filter === "dependencies") return finding.type === "unused_dependency";
  if (filter === "orphans") return finding.type === "orphan_pattern";
  if (filter === "slop") return finding.type === "ai_slop_signal";
  return finding.action === filter;
}

function FindingRow({ finding }: { finding: Finding }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <tr
        className="border-b border-border/60 hover:bg-muted/20 cursor-pointer transition-colors"
        onClick={() => setOpen(!open)}
      >
        <td className="px-3 py-2.5 text-sm">
          <span className="flex items-center gap-1.5">
            {open ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            {typeLabel(finding.type)}
          </span>
        </td>
        <td className="px-3 py-2.5 text-sm max-w-[200px] truncate">{finding.title}</td>
        <td className="px-3 py-2.5 text-sm font-mono text-xs max-w-[180px] truncate text-muted-foreground">
          {findingTarget(finding)}
        </td>
        <td className="px-3 py-2.5 text-sm font-mono tabular-nums">
          {Math.round(finding.confidence * 100)}%
        </td>
        <td className={cn("px-3 py-2.5 text-sm capitalize", severityColor(finding.severity))}>
          {finding.severity}
        </td>
        <td className="px-3 py-2.5">
          <Badge variant={actionVariant(finding.action)} className="text-[10px] font-normal">
            {actionLabel(finding.action)}
          </Badge>
        </td>
        <td className="px-3 py-2.5 text-sm font-mono text-xs text-muted-foreground">
          {sourceLabel(finding.source)}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-border/60 bg-muted/10">
          <td colSpan={7} className="px-4 py-4">
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Reason</p>
                <p className="text-muted-foreground leading-relaxed">{finding.reason}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                  Confidence
                </p>
                <p className="text-muted-foreground">{confidenceExplanation(finding.confidence)}</p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Files</p>
                <ul className="font-mono text-xs text-muted-foreground space-y-0.5">
                  {finding.files.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                  {finding.files.length === 0 && <li>—</li>}
                </ul>
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                  Patch preview (Phase 3)
                </p>
                <p className="text-muted-foreground font-mono text-xs">{patchPreview(finding)}</p>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function FindingsTable({ findings }: { findings: Finding[] }) {
  const [filter, setFilter] = useState<FilterKey>("all");

  const filtered = useMemo(
    () => findings.filter((f) => matchesFilter(f, filter)),
    [findings, filter]
  );

  return (
    <Card className="border-border/80">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Detailed findings</CardTitle>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs transition-colors",
                filter === f.key
                  ? "border-electric/40 bg-electric/10 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/40"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="px-0 pb-0 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Finding</th>
              <th className="px-3 py-2 font-medium">Files / Package</th>
              <th className="px-3 py-2 font-medium">Confidence</th>
              <th className="px-3 py-2 font-medium">Severity</th>
              <th className="px-3 py-2 font-medium">Action</th>
              <th className="px-3 py-2 font-medium">Source</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No findings match this filter.
                </td>
              </tr>
            ) : (
              filtered.map((f) => <FindingRow key={f.id} finding={f} />)
            )}
          </tbody>
        </table>
        <p className="px-4 py-3 text-xs text-muted-foreground border-t border-border">
          Showing {filtered.length} of {findings.length} findings
        </p>
      </CardContent>
    </Card>
  );
}
