"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { Finding, FindingsPayload } from "@/lib/findings/types";
import { Panel } from "@/components/design-system/panel";
import { RiskBadge } from "@/components/design-system/risk-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FindingDetail } from "./finding-detail";
import {
  actionLabel,
  confidenceTierLabel,
  confidenceTierVariant,
  formatFindingAnalyzerLabel,
  findingTarget,
  sortFindingsByPriority,
  typeLabel,
} from "../findings/findings-utils";
import { cn } from "@/lib/utils";

type CategoryKey =
  | "all"
  | "duplicates"
  | "dead_files"
  | "dependencies"
  | "orphans"
  | "slop"
  | "protected";

type BucketKey = "all" | "safe_candidate" | "review_first" | "do_not_touch";

const CATEGORIES: { key: CategoryKey; label: string }[] = [
  { key: "all", label: "All findings" },
  { key: "duplicates", label: "Potential Duplicates" },
  { key: "dead_files", label: "Potentially Unreferenced" },
  { key: "dependencies", label: "Unused Dependencies" },
  { key: "orphans", label: "Potential Orphan Modules" },
  { key: "slop", label: "AI-Slop Signals" },
  { key: "protected", label: "Protected Files" },
];

const BUCKETS: { key: BucketKey; label: string; level?: "safe" | "review" | "protected" }[] = [
  { key: "all", label: "All buckets" },
  { key: "safe_candidate", label: "Safe Candidate", level: "safe" },
  { key: "review_first", label: "Review First", level: "review" },
  { key: "do_not_touch", label: "Do Not Touch", level: "protected" },
];

export function matchesCategory(finding: Finding, category: CategoryKey): boolean {
  if (category === "all") return true;
  if (category === "duplicates") return finding.type === "duplicate_code";
  if (category === "dead_files")
    return (
      finding.type === "unused_file" ||
      finding.type === "unused_export" ||
      finding.type === "unused_import"
    );
  if (category === "dependencies") return finding.type === "unused_dependency";
  if (category === "orphans") return finding.type === "orphan_pattern";
  if (category === "slop") return finding.type === "ai_slop_signal";
  if (category === "protected") return finding.action === "do_not_touch";
  return true;
}

export function matchesBucket(finding: Finding, bucket: BucketKey): boolean {
  if (bucket === "all") return true;
  return finding.action === bucket;
}

interface FindingsWorkspaceProps {
  findings: Finding[];
  rawToolReports?: FindingsPayload["rawToolReports"];
  selectedForPatch?: string[];
  onTogglePatchSelection?: (findingId: string) => void;
  onClearSelection?: () => void;
  onSelectFindingIds?: (ids: string[]) => void;
}

export function FindingsWorkspace({
  findings,
  rawToolReports,
  selectedForPatch = [],
  onTogglePatchSelection,
  onClearSelection,
  onSelectFindingIds,
}: FindingsWorkspaceProps) {
  const [category, setCategory] = useState<CategoryKey>("all");
  const [bucket, setBucket] = useState<BucketKey>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(findings[0]?.id ?? null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  const categoryCounts = useMemo(() => {
    const counts = {} as Record<CategoryKey, number>;
    for (const cat of CATEGORIES) {
      counts[cat.key] =
        cat.key === "all"
          ? findings.length
          : findings.filter((f) => matchesCategory(f, cat.key)).length;
    }
    return counts;
  }, [findings]);

  const bucketCounts = useMemo(() => {
    const counts = {} as Record<BucketKey, number>;
    for (const b of BUCKETS) {
      counts[b.key] =
        b.key === "all"
          ? findings.length
          : findings.filter((f) => matchesBucket(f, b.key)).length;
    }
    return counts;
  }, [findings]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matched = findings.filter((f) => {
      if (!matchesCategory(f, category)) return false;
      if (!matchesBucket(f, bucket)) return false;
      if (!q) return true;
      return (
        f.title.toLowerCase().includes(q) ||
        f.files.some((file) => file.toLowerCase().includes(q)) ||
        (f.packageName?.toLowerCase().includes(q) ?? false)
      );
    });
    return sortFindingsByPriority(matched);
  }, [findings, category, bucket, search]);

  const selectableInView = useMemo(
    () => filtered.filter((f) => f.action === "safe_candidate").map((f) => f.id),
    [filtered]
  );
  const selectedCount = selectedForPatch.length;
  const selected = filtered.find((f) => f.id === selectedId) ?? filtered[0] ?? null;

  const selectFinding = (id: string) => {
    setSelectedId(id);
    setMobileDetailOpen(true);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr_300px]">
      {/* Filters */}
      <Panel variant="elevated" padding="sm" className="lg:max-h-[640px] lg:overflow-y-auto scrollbar-thin">
        <p className="ds-label mb-3">Categories</p>
        <ul className="space-y-1">
          {CATEGORIES.map((cat) => (
            <li key={cat.key}>
              <button
                type="button"
                onClick={() => setCategory(cat.key)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                  category === cat.key
                    ? "bg-electric/10 text-electric"
                    : "text-muted-foreground hover:bg-card hover:text-foreground"
                )}
              >
                <span>{cat.label}</span>
                <span className="font-mono tabular-nums opacity-80">{categoryCounts[cat.key]}</span>
              </button>
            </li>
          ))}
        </ul>

        <p className="ds-label mb-2 mt-5">Risk buckets</p>
        <ul className="space-y-1">
          {BUCKETS.map((b) => (
            <li key={b.key}>
              <button
                type="button"
                onClick={() => setBucket(b.key)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                  bucket === b.key
                    ? "bg-electric/10 text-electric"
                    : "text-muted-foreground hover:bg-card hover:text-foreground"
                )}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate">{b.label}</span>
                  {b.level && b.key !== "all" && (
                    <RiskBadge level={b.level}>{actionLabel(b.key)}</RiskBadge>
                  )}
                </span>
                <span className="shrink-0 font-mono tabular-nums opacity-80">
                  {bucketCounts[b.key]}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <p className="mt-4 border-t border-border/40 pt-3 font-mono text-[10px] text-muted-foreground">
          {categoryCounts.all ===
          bucketCounts.safe_candidate + bucketCounts.review_first + bucketCounts.do_not_touch
            ? `${categoryCounts.all} findings · buckets sum match`
            : `${categoryCounts.all} findings · bucket sum mismatch`}
        </p>
      </Panel>

      {/* List */}
      <Panel variant="elevated" padding="none" className="flex min-h-[400px] flex-col overflow-hidden">
        <div className="space-y-2 border-b border-border/60 p-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              placeholder="Search findings…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 pl-8 font-mono text-xs"
              aria-label="Search findings"
            />
          </div>
          {onTogglePatchSelection && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] text-muted-foreground">
                {selectedCount} selected for cleanup
              </span>
              {onClearSelection && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={selectedCount === 0}
                  onClick={onClearSelection}
                >
                  Clear selection
                </Button>
              )}
              {onSelectFindingIds && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={selectableInView.length === 0}
                  onClick={() => onSelectFindingIds(selectableInView)}
                >
                  Select visible safe ({selectableInView.length})
                </Button>
              )}
            </div>
          )}
        </div>

        <ul className="flex-1 overflow-y-auto scrollbar-thin" role="listbox" aria-label="Findings list">
          {filtered.length === 0 ? (
            <li className="p-6 text-center text-sm text-muted-foreground">No findings match filters.</li>
          ) : (
            filtered.map((finding) => {
              return (
                <li key={finding.id}>
                  <div
                    className={cn(
                      "flex w-full border-b border-border/40 transition-colors",
                      selected?.id === finding.id ? "bg-electric/5 border-l-2 border-l-electric" : "hover:bg-card"
                    )}
                  >
                    {onTogglePatchSelection && finding.action === "safe_candidate" && (
                      <label className="flex items-start px-3 py-3">
                        <input
                          type="checkbox"
                          checked={selectedForPatch.includes(finding.id)}
                          onChange={() => onTogglePatchSelection(finding.id)}
                          className="mt-1 h-3.5 w-3.5 accent-electric"
                          aria-label={`Include ${finding.title} in patch bundle`}
                        />
                      </label>
                    )}
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected?.id === finding.id}
                      onClick={() => selectFinding(finding.id)}
                      className="min-w-0 flex-1 px-3 py-3 text-left"
                    >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">{finding.title}</p>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        {finding.confidenceTier && (
                          <RiskBadge level={confidenceTierVariant(finding.confidenceTier)}>
                            {confidenceTierLabel(finding.confidenceTier)}
                          </RiskBadge>
                        )}
                        <RiskBadge
                          level={
                            finding.action === "safe_candidate"
                              ? "safe"
                              : finding.action === "do_not_touch"
                                ? "protected"
                                : "review"
                          }
                        >
                          {actionLabel(finding.action)}
                        </RiskBadge>
                      </div>
                    </div>
                    <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                      {findingTarget(finding)}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {typeLabel(finding.type)} · {formatFindingAnalyzerLabel(finding, rawToolReports)}
                    </p>
                    </button>
                  </div>
                </li>
              );
            })
          )}
        </ul>
        <p className="border-t border-border/60 px-3 py-2 text-[10px] text-muted-foreground">
          Showing {filtered.length} of {findings.length} findings
          {selectedCount > 0 ? ` · ${selectedCount} selected` : ""}
        </p>
      </Panel>

      {/* Detail — desktop */}
      <div className="hidden lg:block">
        {selected ? (
          <FindingDetail finding={selected} rawToolReports={rawToolReports} />
        ) : (
          <Panel variant="elevated" padding="md" className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">Select a finding to inspect details.</p>
          </Panel>
        )}
      </div>

      {/* Detail — mobile sheet */}
      {mobileDetailOpen && selected && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileDetailOpen(false)}
            aria-label="Close finding detail"
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-xl border-t border-border/60 bg-[#05080D] p-4 scrollbar-thin">
            <FindingDetail finding={selected} rawToolReports={rawToolReports} onClose={() => setMobileDetailOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
