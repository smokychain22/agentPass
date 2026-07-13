"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/design-system/panel";
import type { FindingsPayload } from "@/lib/findings/types";
import { flattenFindings } from "@/lib/findings/client";
import { isActionableFinding } from "@/lib/findings/actionability-signals";

interface FindingsProgressionBannerProps {
  findings: FindingsPayload;
  selectedCount: number;
  onSelectAllSafe?: () => void;
}

export function FindingsProgressionBanner({
  findings,
  selectedCount,
  onSelectAllSafe,
}: FindingsProgressionBannerProps) {
  const flat = flattenFindings(findings);
  const total = flat.length;
  const ready = flat.filter((f) => f.action === "safe_candidate" && isActionableFinding(f)).length;
  const review = total - ready;

  return (
    <Panel variant="elevated" padding="md" className="border-border/60">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="ds-label mb-2">What can RepoDiet safely fix?</p>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="text-signal">Scan complete</span>
            <ArrowRight className="h-3.5 w-3.5 opacity-50" aria-hidden />
            <span className="font-mono">{total} findings</span>
            <ArrowRight className="h-3.5 w-3.5 opacity-50" aria-hidden />
            <span className={ready > 0 ? "font-mono text-signal" : "font-mono text-amber-300"}>
              {ready} ready for cleanup
            </span>
            <ArrowRight className="h-3.5 w-3.5 opacity-50" aria-hidden />
            <span>{ready > 0 ? "select scope to continue" : "action required"}</span>
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Findings</dt>
              <dd className="font-mono text-lg">{total}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Ready for automatic cleanup</dt>
              <dd className="font-mono text-lg text-signal">{ready}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Require review</dt>
              <dd className="font-mono text-lg text-amber-300">{review}</dd>
            </div>
          </dl>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {ready > 0 ? (
            <>
              {onSelectAllSafe && (
                <Button variant="secondary" onClick={onSelectAllSafe}>
                  Select all safe findings
                </Button>
              )}
              <Button asChild>
                <Link href="/app?tab=patch">
                  {selectedCount > 0
                    ? `Continue with ${selectedCount} cleanup${selectedCount === 1 ? "" : "s"}`
                    : "Review cleanup scope"}
                </Link>
              </Button>
            </>
          ) : (
            <Button variant="secondary" asChild>
              <Link href="/app?tab=findings#workspace">Review eligibility</Link>
            </Button>
          )}
        </div>
      </div>
    </Panel>
  );
}
