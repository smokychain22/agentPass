"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { Finding, FindingsPayload } from "@/lib/findings/types";
import { Panel } from "@/components/design-system/panel";
import { RiskBadge } from "@/components/design-system/risk-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FindingDetail } from "./finding-detail";
import { FindingsAccordion } from "./findings-accordion";
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
import { isCleanupEligible } from "@/lib/findings/cleanup-eligibility";

type CategoryKey =
  | "all"
  | "duplicates"
  | "dead_files"
  | "dependencies"
  | "orphans"
  | "slop"
  | "protected";

type BucketKey = "all" | "safe_candidate" | "review_first" | "do_not_touch";
type PageSize = 25 | 50 | 100;

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

const STORAGE_KEY = "repodiet.findingsWorkspace.v1";

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

function typeGroupLabel(type: Finding["type"]): string {
  switch (type) {
    case "unused_import":
      return "Unused imports";
    case "unused_export":
      return "Unused exports";
    case "unused_file":
      return "Unused files";
    case "unused_dependency":
      return "Unused dependencies";
    case "duplicate_code":
      return "Duplicates";
    case "orphan_pattern":
      return "Orphan modules";
    case "ai_slop_signal":
      return "AI-slop signals";
    default:
      return type;
  }
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
  const [browseOpen, setBrowseOpen] = useState(false);
  const [safeGroupOpen, setSafeGroupOpen] = useState(true);
  const [reviewGroupOpen, setReviewGroupOpen] = useState(false);
  const [protectedGroupOpen, setProtectedGroupOpen] = useState(false);
  const [category, setCategory] = useState<CategoryKey>("all");
  const [bucket, setBucket] = useState<BucketKey>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        category?: CategoryKey;
        bucket?: BucketKey;
        search?: string;
        page?: number;
        pageSize?: PageSize;
        browseOpen?: boolean;
        expandedIds?: string[];
      };
      if (parsed.category) setCategory(parsed.category);
      if (parsed.bucket) setBucket(parsed.bucket);
      if (typeof parsed.search === "string") setSearch(parsed.search);
      if (parsed.page) setPage(parsed.page);
      if (parsed.pageSize === 25 || parsed.pageSize === 50 || parsed.pageSize === 100) {
        setPageSize(parsed.pageSize);
      }
      if (typeof parsed.browseOpen === "boolean") setBrowseOpen(parsed.browseOpen);
      if (Array.isArray(parsed.expandedIds)) setExpandedIds(parsed.expandedIds);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          category,
          bucket,
          search,
          page,
          pageSize,
          browseOpen,
          expandedIds,
          selectedForPatch,
        })
      );
    } catch {
      /* ignore */
    }
  }, [category, bucket, search, page, pageSize, browseOpen, expandedIds, selectedForPatch]);

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

  useEffect(() => {
    setPage(1);
  }, [category, bucket, search, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageItems = browseOpen
    ? filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)
    : [];

  const selectableEligible = useMemo(
    () => filtered.filter(isCleanupEligible).map((f) => f.id),
    [filtered]
  );
  const selectedCount = selectedForPatch.length;
  const selected =
    pageItems.find((f) => f.id === selectedId) ??
    filtered.find((f) => f.id === selectedId) ??
    null;

  const safeFindings = findings.filter((f) => f.action === "safe_candidate");
  const reviewFindings = findings.filter((f) => f.action === "review_first");
  const protectedFindings = findings.filter((f) => f.action === "do_not_touch");

  const selectFinding = (id: string) => {
    setSelectedId(id);
    setMobileDetailOpen(true);
    setExpandedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  };

  const collapseAll = () => {
    setExpandedIds([]);
    setSelectedId(null);
  };

  const expandCurrentResult = () => {
    setExpandedIds(pageItems.map((f) => f.id));
  };

  const scrollTop = () => {
    document.getElementById("findings-browse-top")?.scrollIntoView({ behavior: "smooth" });
  };

  const renderFindingRow = (finding: Finding) => {
    const expanded = expandedIds.includes(finding.id);
    return (
      <li key={finding.id} data-finding-card={finding.id}>
        <div
          className={cn(
            "flex w-full border-b border-border/40 transition-colors",
            selected?.id === finding.id ? "bg-electric/5 border-l-2 border-l-electric" : "hover:bg-card"
          )}
        >
          {onTogglePatchSelection && isCleanupEligible(finding) && (
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
            className="min-w-0 flex-1 px-3 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-electric"
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
        {expanded && selected?.id === finding.id ? (
          <div className="border-b border-border/40 bg-card/40 p-3 lg:hidden">
            <FindingDetail finding={finding} rawToolReports={rawToolReports} />
          </div>
        ) : null}
      </li>
    );
  };

  const renderTypeGroups = (items: Finding[], open: boolean) => {
    if (!open) return null;
    const byType = new Map<string, Finding[]>();
    for (const f of items) {
      const key = typeGroupLabel(f.type);
      const list = byType.get(key) ?? [];
      list.push(f);
      byType.set(key, list);
    }
    return (
      <div className="space-y-2">
        {[...byType.entries()].map(([label, group]) => (
          <FindingsAccordion
            key={label}
            title={`${label} — ${group.length}`}
            defaultOpen={false}
          >
            <ul className="max-h-64 overflow-y-auto scrollbar-thin" role="list">
              {group.slice(0, 25).map((f) => (
                <li key={f.id} className="border-b border-border/30 py-2 text-sm last:border-0">
                  <button
                    type="button"
                    className="w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-electric"
                    onClick={() => {
                      setBrowseOpen(true);
                      setBucket(
                        f.action === "safe_candidate"
                          ? "safe_candidate"
                          : f.action === "do_not_touch"
                            ? "do_not_touch"
                            : "review_first"
                      );
                      selectFinding(f.id);
                    }}
                  >
                    <span className="font-medium">{f.title}</span>
                    <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                      {findingTarget(f)}
                    </span>
                  </button>
                </li>
              ))}
              {group.length > 25 ? (
                <li className="py-2 text-xs text-muted-foreground">
                  Showing first 25 of {group.length}. Use Browse findings for the full list.
                </li>
              ) : null}
            </ul>
          </FindingsAccordion>
        ))}
      </div>
    );
  };

  return (
    <div id="workspace" className="space-y-4">
      <div className="space-y-2">
        <FindingsAccordion
          title={`Safe candidates — ${safeFindings.length}`}
          summary="Expanded summary · cards collapsed by default"
          open={safeGroupOpen}
          onOpenChange={setSafeGroupOpen}
        >
          <p className="mb-2 text-sm text-muted-foreground">
            Risk bucket SAFE. Cleanup requires transformer preflight (
            {findings.filter(isCleanupEligible).length} cleanup-eligible).
          </p>
          {renderTypeGroups(safeFindings, safeGroupOpen)}
        </FindingsAccordion>
        <FindingsAccordion
          title={`Review first — ${reviewFindings.length}`}
          open={reviewGroupOpen}
          onOpenChange={setReviewGroupOpen}
        >
          {renderTypeGroups(reviewFindings, reviewGroupOpen)}
        </FindingsAccordion>
        <FindingsAccordion
          title={`Do not touch — ${protectedFindings.length}`}
          open={protectedGroupOpen}
          onOpenChange={setProtectedGroupOpen}
        >
          {renderTypeGroups(protectedFindings, protectedGroupOpen)}
        </FindingsAccordion>
      </div>

      <FindingsAccordion
        title={`Browse ${findings.length} findings`}
        summary={
          browseOpen
            ? `Showing ${pageItems.length} of ${filtered.length} filtered · page ${currentPage}/${totalPages}`
            : "Collapsed — no finding cards mounted"
        }
        open={browseOpen}
        onOpenChange={setBrowseOpen}
      >
        <div id="findings-browse-top" className="grid gap-4 lg:grid-cols-[220px_1fr_300px]">
          <Panel
            variant="elevated"
            padding="sm"
            className="sticky top-2 lg:max-h-[640px] lg:overflow-y-auto scrollbar-thin"
          >
            <p className="ds-label mb-3">Categories</p>
            <ul className="space-y-1">
              {CATEGORIES.map((cat) => (
                <li key={cat.key}>
                  <button
                    type="button"
                    onClick={() => setCategory(cat.key)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-electric",
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
                      "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-electric",
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
          </Panel>

          <Panel variant="elevated" padding="none" className="flex min-h-[400px] flex-col overflow-hidden">
            <div className="sticky top-0 z-10 space-y-2 border-b border-border/60 bg-[#05080D]/95 p-3 backdrop-blur">
              <div className="relative">
                <Search
                  className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  placeholder="Search findings…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-9 pl-8 font-mono text-xs"
                  aria-label="Search findings"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                  Page size
                  <select
                    className="rounded border border-border/50 bg-card px-1 py-0.5"
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value) as PageSize)}
                    aria-label="Findings page size"
                  >
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </label>
                <Button type="button" size="sm" variant="ghost" onClick={collapseAll}>
                  Collapse all
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={expandCurrentResult}
                  disabled={pageItems.length === 0}
                >
                  Expand current result
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={scrollTop}>
                  Back to top
                </Button>
                {onTogglePatchSelection && (
                  <>
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
                        disabled={selectableEligible.length === 0}
                        onClick={() => onSelectFindingIds(selectableEligible)}
                      >
                        Select cleanup-eligible ({selectableEligible.length})
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>

            <ul
              className="flex-1 overflow-y-auto scrollbar-thin"
              role="listbox"
              aria-label="Findings list"
              data-rendered-finding-cards={pageItems.length}
            >
              {!browseOpen ? null : filtered.length === 0 ? (
                <li className="p-6 text-center text-sm text-muted-foreground">
                  No findings match filters.
                </li>
              ) : (
                pageItems.map(renderFindingRow)
              )}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-3 py-2 text-[10px] text-muted-foreground">
              <p>
                Showing {pageItems.length} of {filtered.length} filtered ({findings.length} total)
                {selectedCount > 0 ? ` · ${selectedCount} selected` : ""}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={currentPage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <span className="font-mono">
                  {currentPage} / {totalPages}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Load more
                </Button>
              </div>
            </div>
          </Panel>

          <div className="hidden lg:block">
            {selected ? (
              <FindingDetail finding={selected} rawToolReports={rawToolReports} />
            ) : (
              <Panel
                variant="elevated"
                padding="md"
                className="flex h-full items-center justify-center"
              >
                <p className="text-sm text-muted-foreground">
                  Select a finding to inspect details.
                </p>
              </Panel>
            )}
          </div>

          {mobileDetailOpen && selected && (
            <div className="fixed inset-0 z-50 lg:hidden">
              <button
                type="button"
                className="absolute inset-0 bg-black/60"
                onClick={() => setMobileDetailOpen(false)}
                aria-label="Close finding detail"
              />
              <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-xl border-t border-border/60 bg-[#05080D] p-4 scrollbar-thin">
                <FindingDetail
                  finding={selected}
                  rawToolReports={rawToolReports}
                  onClose={() => setMobileDetailOpen(false)}
                />
              </div>
            </div>
          )}
        </div>
      </FindingsAccordion>
    </div>
  );
}
