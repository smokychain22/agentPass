"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/design-system/panel";
import type { FindingsPayload } from "@/lib/findings/types";
import { flattenFindings } from "@/lib/findings/client";
import {
  countCleanupEligible,
  isCleanupEligible,
} from "@/lib/findings/cleanup-eligibility";

interface FindingsProgressionBannerProps {
  findings: FindingsPayload;
  selectedCount: number;
  onSelectAllSafe?: () => void;
  onClearSelection?: () => void;
}

export function FindingsProgressionBanner({
  findings,
  selectedCount,
  onSelectAllSafe,
  onClearSelection,
}: FindingsProgressionBannerProps) {
  const flat = flattenFindings(findings);
  const total = flat.length;
  const safeCandidates = flat.filter((f) => f.action === "safe_candidate").length;
  const cleanupEligible =
    findings.summary.eligibleFindings ?? countCleanupEligible(flat);
  const reviewFirst = flat.filter((f) => f.action === "review_first").length;
  const doNotTouch = flat.filter((f) => f.action === "do_not_touch").length;
  const bucketSum = safeCandidates + reviewFirst + doNotTouch;
  const canContinue = selectedCount > 0 && cleanupEligible > 0;

  return (
    <Panel variant="elevated" padding="md" className="border-border/60">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="ds-label mb-2">What can RepoDiet safely fix?</p>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="text-signal">Findings analyzed</span>
            <ArrowRight className="h-3.5 w-3.5 opacity-50" aria-hidden />
            <span className="font-mono">{total} findings</span>
            <ArrowRight className="h-3.5 w-3.5 opacity-50" aria-hidden />
            <span
              className={
                cleanupEligible > 0 ? "font-mono text-signal" : "font-mono text-amber-300"
              }
            >
              {cleanupEligible} cleanup-eligible after preflight
            </span>
            <ArrowRight className="h-3.5 w-3.5 opacity-50" aria-hidden />
            <span>{cleanupEligible > 0 ? "select scope to continue" : "action required"}</span>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Findings</dt>
              <dd className="font-mono text-lg">{total}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Ready for automatic cleanup</dt>
              <dd
                className={
                  cleanupEligible > 0
                    ? "font-mono text-lg text-signal"
                    : "font-mono text-lg text-amber-300"
                }
              >
                {cleanupEligible}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Review first</dt>
              <dd className="font-mono text-lg text-amber-300">{reviewFirst}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Do not touch</dt>
              <dd className="font-mono text-lg text-muted-foreground">{doNotTouch}</dd>
            </div>
          </dl>
          <p className="mt-2 font-mono text-[10px] text-muted-foreground">
            {safeCandidates} safe candidates · {cleanupEligible} cleanup-eligible after preflight ·
            selected {selectedCount}
            {bucketSum === total
              ? " · category buckets sum to total"
              : ` · WARNING: bucket sum ${bucketSum} ≠ total ${total}`}
          </p>
          {cleanupEligible === 0 && (
            <p className="mt-2 text-sm text-amber-200">
              No findings passed transformer preflight. Safe-candidate risk buckets alone are not
              enough for automatic cleanup.
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {onClearSelection && (
            <Button
              variant="secondary"
              onClick={onClearSelection}
              disabled={selectedCount === 0}
            >
              Clear selection
            </Button>
          )}
          {onSelectAllSafe && (
            <Button
              variant="secondary"
              onClick={onSelectAllSafe}
              disabled={cleanupEligible === 0}
            >
              Select all cleanup-eligible findings
            </Button>
          )}
          {canContinue ? (
            <Button asChild data-continue-primary="true">
              <Link href="/app?tab=patch" data-continue-selected={selectedCount}>
                Continue to Quick Cleanup · {selectedCount} selected for cleanup
              </Link>
            </Button>
          ) : (
            <Button variant="secondary" disabled data-continue-primary="true">
              Continue to Quick Cleanup
            </Button>
          )}
          {cleanupEligible === 0 && (
            <Button variant="secondary" asChild>
              <Link href="/app?tab=findings#workspace">Review eligibility</Link>
            </Button>
          )}
        </div>
      </div>
    </Panel>
  );
}
