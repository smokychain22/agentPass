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
  sortFindingsByPriority,
} from "../findings/findings-utils";
import { cn } from "@/lib/utils";
import { isCleanupEligible } from "@/lib/findings/cleanup-eligibility";
import {
  getFindingCheckboxState,
  offFilterCleanupSelectionMessage,
  runReviewSelectionAction,
} from "@/lib/findings/selection-purposes";
import {
  automationBlockReason,
  findingFileName,
  findingTargetPath,
  plainLanguageTitle,
  plainLanguageWhatChanges,
  plainLanguageWhy,
  plainLanguageNextStep,
  plainRiskLabel,
  plainRiskLevel,
} from "@/lib/findings/plain-language";
import { FindingSelectionCheckbox } from "./finding-selection-checkbox";
import { useFeedbackToast } from "@/components/app/ui/feedback-banner";

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
  { key: "duplicates", label: "Duplicate groups" },
  { key: "dead_files", label: "Potentially Unreferenced" },
  { key: "dependencies", label: "Unused Dependencies" },
  { key: "orphans", label: "Potential Orphan Modules" },
  { key: "slop", label: "AI-Slop Signals" },
  { key: "protected", label: "Protected Files" },
];

const BUCKETS: { key: BucketKey; label: string; level?: "safe" | "review" | "protected" }[] = [
  { key: "all", label: "All suggestions" },
  { key: "safe_candidate", label: "Safe cleanup", level: "safe" },
  { key: "review_first", label: "Needs review", level: "review" },
  { key: "do_not_touch", label: "Do not change", level: "protected" },
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

interface FindingsWorkspaceProps {
  findings: Finding[];
  rawToolReports?: FindingsPayload["rawToolReports"];
  /** Cleanup-eligible SAFE selection only. */
  selectedForPatch?: string[];
  reviewSelectedFindingIds?: string[];
  inspectionSelectedFindingIds?: string[];
  onTogglePatchSelection?: (findingId: string) => void;
  onClearSelection?: () => void;
  onClearReviewSelection?: () => void;
  onSelectFindingIds?: (ids: string[]) => void;
}

export function FindingsWorkspace({
  findings,
  rawToolReports,
  selectedForPatch = [],
  reviewSelectedFindingIds = [],
  inspectionSelectedFindingIds = [],
  onTogglePatchSelection,
  onClearSelection,
  onClearReviewSelection,
  onSelectFindingIds,
}: FindingsWorkspaceProps) {
  const { show, Toast } = useFeedbackToast();
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
  const reviewSelectedCount = reviewSelectedFindingIds.length;
  const visibleIds = useMemo(() => new Set(filtered.map((f) => f.id)), [filtered]);
  const offFilterMessage = useMemo(
    () =>
      offFilterCleanupSelectionMessage({
        activeBucket: bucket,
        cleanupSelectedIds: selectedForPatch,
        findings,
        visibleFindingIds: visibleIds,
      }),
    [bucket, selectedForPatch, findings, visibleIds]
  );

  const selected =
    pageItems.find((f) => f.id === selectedId) ??
    filtered.find((f) => f.id === selectedId) ??
    null;

  const safeFindings = useMemo(
    () => findings.filter((f) => f.action === "safe_candidate"),
    [findings]
  );
  /** Cleanup-eligible rows inside the SAFE bucket — canonical preflight, keyed by finding.id. */
  const safeCleanupEligible = useMemo(
    () => safeFindings.filter(isCleanupEligible),
    [safeFindings]
  );
  const reviewFindings = useMemo(
    () => findings.filter((f) => f.action === "review_first"),
    [findings]
  );
  const protectedFindings = useMemo(
    () => findings.filter((f) => f.action === "do_not_touch"),
    [findings]
  );

  const selectFinding = (id: string) => {
    setSelectedId(id);
    setMobileDetailOpen(true);
    setExpandedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  };

  const showSelectedCleanupFinding = () => {
    const id = selectedForPatch.find((fid) => !visibleIds.has(fid)) ?? selectedForPatch[0];
    if (!id) return;
    setBucket("safe_candidate");
    setCategory("all");
    setSearch("");
    setBrowseOpen(true);
    setSafeGroupOpen(true);
    selectFinding(id);
    window.requestAnimationFrame(() => {
      document
        .querySelector(`[data-finding-id="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
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

  const isCheckedForPurpose = (finding: Finding): boolean => {
    const purpose = getFindingCheckboxState(finding).purpose;
    if (purpose === "cleanup") return selectedForPatch.includes(finding.id);
    if (purpose === "review") return reviewSelectedFindingIds.includes(finding.id);
    if (purpose === "inspection") return inspectionSelectedFindingIds.includes(finding.id);
    return false;
  };

  const renderFindingRow = (finding: Finding, options?: { compact?: boolean }) => {
    const expanded = expandedIds.includes(finding.id);
    const checkbox = getFindingCheckboxState(finding);
    const cleanupEligible = checkbox.purpose === "cleanup";
    const compact = options?.compact === true;
    const risk = plainRiskLevel(finding);
    const blockReason = automationBlockReason(finding);
    return (
      <li
        key={finding.id}
        data-finding-card={finding.id}
        data-finding-id={finding.id}
        data-cleanup-eligible={cleanupEligible ? "true" : "false"}
        data-selection-purpose={checkbox.dataPurpose}
        data-risk-action={finding.action}
      >
        <div
          className={cn(
            "flex w-full border-b border-border/40 transition-colors",
            selected?.id === finding.id ? "bg-electric/5 border-l-2 border-l-electric" : "hover:bg-card"
          )}
        >
          {onTogglePatchSelection ? (
            <FindingSelectionCheckbox
              findingId={finding.id}
              title={plainLanguageTitle(finding)}
              checked={isCheckedForPurpose(finding)}
              enabled={checkbox.enabled}
              purpose={checkbox.dataPurpose}
              ariaLabel={checkbox.ariaLabel}
              onToggle={onTogglePatchSelection}
            />
          ) : (
            <span className="w-10 shrink-0" aria-hidden />
          )}
          <button
            type="button"
            role="option"
            aria-selected={selected?.id === finding.id}
            onClick={() => selectFinding(finding.id)}
            className="min-w-0 flex-1 px-3 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-electric"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{plainLanguageTitle(finding)}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {findingFileName(finding)}
                  <span className="mx-1 text-border">·</span>
                  <span className="font-mono text-[11px]">{findingTargetPath(finding)}</span>
                </p>
              </div>
              <RiskBadge
                level={risk === "safe" ? "safe" : risk === "protected" ? "protected" : "review"}
              >
                {plainRiskLabel(finding)}
              </RiskBadge>
            </div>
            {!compact ? (
              <>
                <p className="mt-2 text-xs text-muted-foreground">{plainLanguageWhy(finding)}</p>
                <p className="mt-1 text-xs text-foreground/80">{plainLanguageWhatChanges(finding)}</p>
                <p className="mt-1 text-xs text-electric">{plainLanguageNextStep(finding)}</p>
                {blockReason ? (
                  <p className="mt-1 text-xs text-warning">{blockReason}</p>
                ) : null}
              </>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                {cleanupEligible
                  ? "Ready for automatic Fix & PR"
                  : blockReason || "Needs review before automatic cleanup"}
              </p>
            )}
            <p className="mt-2 text-[11px] text-electric">
              {expanded && selected?.id === finding.id ? "Hide technical details" : "View technical details"}
            </p>
          </button>
        </div>
        {expanded && selected?.id === finding.id ? (
          <div className="border-b border-border/40 bg-card/40 p-3">
            <p className="mb-2 text-xs font-medium text-foreground">Advanced details</p>
            <FindingDetail finding={finding} rawToolReports={rawToolReports} />
          </div>
        ) : null}
      </li>
    );
  };

  /** Flat list — used for Safe candidates so checkboxes are visible without nested collapse. */
  const renderFlatFindingList = (items: Finding[], listId: string) => {
    if (items.length === 0) {
      return <p className="text-sm text-muted-foreground">No findings in this bucket.</p>;
    }
    return (
      <ul
        className="max-h-[28rem] overflow-y-auto rounded-md border border-border/40 scrollbar-thin"
        role="list"
        data-finding-list={listId}
        data-finding-list-count={items.length}
      >
        {items.map((f) => renderFindingRow(f, { compact: true }))}
      </ul>
    );
  };

  return (
    <div id="workspace" className="space-y-4">
      {Toast}
      <div className="rounded-md border border-border/40 bg-card/30 px-3 py-2 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">How cleanup works</p>
        <ol className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          <li>1. Connect repository</li>
          <li>2. Explore paths or review suggestions</li>
          <li>3. Configure action and review exact patch</li>
          <li>4. Review dynamic quote</li>
          <li>5. Choose payment channel and authorize</li>
          <li>6. Review and merge on GitHub</li>
        </ol>
      </div>
      <div className="space-y-2">
        <FindingsAccordion
          title={`Safe cleanup — ${safeFindings.length}`}
          summary={
            safeGroupOpen
              ? `${safeCleanupEligible.length} ready for automatic Fix & PR`
              : "Open to review suggested safe cleanups"
          }
          open={safeGroupOpen}
          onOpenChange={setSafeGroupOpen}
        >
          <p className="mb-2 text-sm text-muted-foreground">
            Suggested safe cleanups · {safeCleanupEligible.length} can be removed automatically.
            Select the files you want, then continue to Fix &amp; PR.
          </p>
          {selectedCount > 0 ? (
            <p className="mb-2 text-xs text-signal" data-selected-count={selectedCount}>
              {selectedCount} selected for cleanup
            </p>
          ) : (
            <p className="mb-2 text-xs text-muted-foreground" data-selected-count={0}>
              0 selected for cleanup
            </p>
          )}
          {safeGroupOpen ? renderFlatFindingList(safeFindings, "safe-cleanup") : null}
        </FindingsAccordion>
        <FindingsAccordion
          title={`Needs review — ${reviewFindings.length}`}
          summary={
            reviewGroupOpen
              ? "Selectable for review — not automatic Fix & PR yet"
              : "Open to review suggestions that need a human check"
          }
          open={reviewGroupOpen}
          onOpenChange={setReviewGroupOpen}
        >
          <p className="mb-2 text-sm text-muted-foreground">
            These suggestions need a human check first. You can select them for review, but they
            will not be changed automatically until a supported cleanup path exists.
          </p>
          <p
            className="mb-2 font-mono text-xs text-amber-300"
            data-review-selected-count={reviewSelectedCount}
          >
            Review selected: {reviewSelectedCount}
          </p>
          <div className="mb-3 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={reviewSelectedCount === 0}
              data-review-action="deeper_verification"
              onClick={() => {
                const result = runReviewSelectionAction(
                  "deeper_verification",
                  reviewSelectedFindingIds
                );
                show("info", result.message);
              }}
            >
              Run deeper verification
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={reviewSelectedCount === 0}
              data-review-action="review_queue"
              onClick={() => {
                const result = runReviewSelectionAction("review_queue", reviewSelectedFindingIds);
                show("info", result.message);
              }}
            >
              Add to review queue
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={reviewSelectedCount === 0}
              data-review-action="clear"
              onClick={() => {
                onClearReviewSelection?.();
                const result = runReviewSelectionAction("clear", reviewSelectedFindingIds);
                show("info", result.message);
              }}
            >
              Clear review selection
            </Button>
          </div>
          {reviewGroupOpen
            ? renderFlatFindingList(reviewFindings, "review-deeper-selection")
            : null}
        </FindingsAccordion>
        <FindingsAccordion
          title={`Do not touch — ${protectedFindings.length}`}
          summary={
            protectedGroupOpen
              ? "Inspection/reporting selection only — never cleanup"
              : "Open to inspect protected findings"
          }
          open={protectedGroupOpen}
          onOpenChange={setProtectedGroupOpen}
        >
          {protectedGroupOpen
            ? renderFlatFindingList(protectedFindings, "inspection-selection")
            : null}
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
                    <span
                      className="font-mono text-[10px] text-amber-300/90"
                      data-review-selected-count={reviewSelectedCount}
                    >
                      Review selected: {reviewSelectedCount}
                    </span>
                    {onClearSelection && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={selectedCount === 0}
                        onClick={onClearSelection}
                      >
                        Clear cleanup selection
                      </Button>
                    )}
                    {offFilterMessage ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="font-mono text-[10px] text-signal"
                          data-off-filter-cleanup-message="true"
                        >
                          {offFilterMessage}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          data-show-selected-cleanup="true"
                          onClick={showSelectedCleanupFinding}
                        >
                          Show selected cleanup finding
                        </Button>
                      </div>
                    ) : null}
                    {onSelectFindingIds && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={selectableEligible.length === 0}
                        onClick={() => onSelectFindingIds(selectableEligible)}
                      >
                        {selectableEligible.length > 0
                          ? `Select all cleanup-eligible findings (${selectableEligible.length})`
                          : offFilterMessage
                            ? offFilterMessage
                            : "No cleanup-eligible findings in this view"}
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
                pageItems.map((finding) => renderFindingRow(finding))
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
