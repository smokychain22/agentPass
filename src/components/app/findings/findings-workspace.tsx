"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { Finding } from "@/lib/findings/types";
import { Panel } from "@/components/design-system/panel";
import { RiskBadge } from "@/components/design-system/risk-badge";
import { Input } from "@/components/ui/input";
import { FindingDetail } from "./finding-detail";
import {
  actionLabel,
  findingTarget,
  sourceLabel,
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
  { key: "duplicates", label: "Duplicate Logic" },
  { key: "dead_files", label: "Dead Files" },
  { key: "dependencies", label: "Unused Dependencies" },
  { key: "orphans", label: "Orphan Modules" },
  { key: "slop", label: "AI-Slop Signals" },
  { key: "protected", label: "Protected Files" },
];

const BUCKETS: { key: BucketKey; label: string; level?: "safe" | "review" | "protected" }[] = [
  { key: "all", label: "All buckets" },
  { key: "safe_candidate", label: "Safe Candidate", level: "safe" },
  { key: "review_first", label: "Review First", level: "review" },
  { key: "do_not_touch", label: "Do Not Touch", level: "protected" },
];

function matchesCategory(finding: Finding, category: CategoryKey): boolean {
  if (category === "all") return true;
  if (category === "duplicates") return finding.type === "duplicate_code";
  if (category === "dead_files")
    return finding.type === "unused_file" || finding.type === "unused_export";
  if (category === "dependencies") return finding.type === "unused_dependency";
  if (category === "orphans") return finding.type === "orphan_pattern";
  if (category === "slop") return finding.type === "ai_slop_signal";
  if (category === "protected") return finding.action === "do_not_touch";
  return true;
}

function matchesBucket(finding: Finding, bucket: BucketKey): boolean {
  if (bucket === "all") return true;
  return finding.action === bucket;
}

interface FindingsWorkspaceProps {
  findings: Finding[];
}

export function FindingsWorkspace({ findings }: FindingsWorkspaceProps) {
  const [category, setCategory] = useState<CategoryKey>("all");
  const [bucket, setBucket] = useState<BucketKey>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(findings[0]?.id ?? null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return findings.filter((f) => {
      if (!matchesCategory(f, category)) return false;
      if (!matchesBucket(f, bucket)) return false;
      if (!q) return true;
      return (
        f.title.toLowerCase().includes(q) ||
        f.files.some((file) => file.toLowerCase().includes(q)) ||
        (f.packageName?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [findings, category, bucket, search]);

  const selected = filtered.find((f) => f.id === selectedId) ?? filtered[0] ?? null;

  const selectFinding = (id: string) => {
    setSelectedId(id);
    setMobileDetailOpen(true);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[200px_1fr_300px]">
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
                  "w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                  category === cat.key
                    ? "bg-electric/10 text-electric"
                    : "text-muted-foreground hover:bg-card hover:text-foreground"
                )}
              >
                {cat.label}
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
                  "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                  bucket === b.key
                    ? "bg-electric/10 text-electric"
                    : "text-muted-foreground hover:bg-card hover:text-foreground"
                )}
              >
                {b.label}
                {b.level && b.key !== "all" && (
                  <RiskBadge level={b.level}>{actionLabel(b.key)}</RiskBadge>
                )}
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      {/* List */}
      <Panel variant="elevated" padding="none" className="flex min-h-[400px] flex-col overflow-hidden">
        <div className="border-b border-border/60 p-3">
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
        </div>

        <ul className="flex-1 overflow-y-auto scrollbar-thin" role="listbox" aria-label="Findings list">
          {filtered.length === 0 ? (
            <li className="p-6 text-center text-sm text-muted-foreground">No findings match filters.</li>
          ) : (
            filtered.map((finding) => {
              const active = selected?.id === finding.id;
              return (
                <li key={finding.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => selectFinding(finding.id)}
                    className={cn(
                      "w-full border-b border-border/40 px-3 py-3 text-left transition-colors",
                      active ? "bg-electric/5 border-l-2 border-l-electric" : "hover:bg-card"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">{finding.title}</p>
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
                    <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                      {findingTarget(finding)}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {typeLabel(finding.type)} · {sourceLabel(finding.source)}
                    </p>
                  </button>
                </li>
              );
            })
          )}
        </ul>
        <p className="border-t border-border/60 px-3 py-2 text-[10px] text-muted-foreground">
          {filtered.length} of {findings.length} findings
        </p>
      </Panel>

      {/* Detail — desktop */}
      <div className="hidden lg:block">
        {selected ? (
          <FindingDetail finding={selected} />
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
            <FindingDetail finding={selected} onClose={() => setMobileDetailOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
