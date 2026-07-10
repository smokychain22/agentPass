"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppSession } from "@/components/app/app-session";
import { LockedTab, WorkspaceSection } from "@/components/app/locked-tab";
import { flattenFindings } from "@/lib/findings/client";
import {
  FREE_CLEANUP_LIMIT,
  eligibilityReason,
  freeCleanupCta,
  isAutoFixEligible,
  isReviewPlanEligible,
} from "@/lib/cleanup/eligibility";
import type { FreeCleanupResult } from "@/lib/cleanup/run-free-cleanup";
import type { Finding } from "@/lib/findings/types";
import { LoadingProgress } from "@/components/app/ui/loading-progress";
import { ErrorState } from "@/components/app/ui/error-state";
import { FeedbackBanner, useFeedbackToast } from "@/components/app/ui/feedback-banner";
import { Panel } from "@/components/design-system/panel";
import { RiskBadge } from "@/components/design-system/risk-badge";

export function CleanupTab() {
  const { session, findings } = useAppSession();
  const { show, Toast } = useFeedbackToast();
  const [phase, setPhase] = useState<"idle" | "running" | "complete" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FreeCleanupResult | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const allFindings = useMemo(() => (findings ? flattenFindings(findings) : []), [findings]);
  const cta = useMemo(() => freeCleanupCta(allFindings), [allFindings]);

  const eligibleForSelection = useMemo(() => {
    if (cta.mode === "auto_fix") return allFindings.filter(isAutoFixEligible);
    return allFindings.filter(isReviewPlanEligible);
  }, [allFindings, cta.mode]);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= FREE_CLEANUP_LIMIT) return prev;
      return [...prev, id];
    });
  };

  const runCleanup = useCallback(async () => {
    if (!findings) return;
    setError(null);
    setPhase("running");
    show("info", "Running free cleanup in isolated workspace…");

    try {
      const res = await fetch("/api/cleanup/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scanId: findings.scanId,
          findings,
          findingIds: selectedIds.length ? selectedIds : undefined,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Cleanup failed.");
      setResult(json.cleanup as FreeCleanupResult);
      setPhase("complete");
      show("success", json.cleanup.verifiedLabel ?? "Cleanup complete");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Cleanup failed.";
      setError(msg);
      setPhase("failed");
      show("error", "Cleanup failed");
    }
  }, [findings, selectedIds, show]);

  if (!findings) {
    return (
      <LockedTab
        step="Free"
        title="Free Cleanup Run"
        description="Available after findings analysis. Run the Findings Engine first."
      />
    );
  }

  const canRun =
    cta.count > 0 && (selectedIds.length > 0 || eligibleForSelection.length > 0);

  return (
    <div className="space-y-6">
      {Toast}

      <WorkspaceSection
        label="In-app proof"
        title="Free Proof"
        description={
          cta.mode === "auto_fix"
            ? "RepoDiet fixes one supported safe issue, validates it in an isolated workspace, and shows the real diff. Your GitHub repository is not modified."
            : "No findings met the automatic-fix safety threshold. RepoDiet will generate a conservative review plan without changing code."
        }
        actions={
          <>
            <Button onClick={runCleanup} disabled={!canRun || phase === "running"}>
              {phase === "running" ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden />
                  Running…
                </>
              ) : (
                cta.label
              )}
            </Button>
            <Button variant="ghost" asChild>
              <Link href="/app?tab=findings">Back to Findings</Link>
            </Button>
            {result && (
              <Button variant="secondary" asChild>
                <Link href="/app?tab=patch">Continue to Quick Cleanup</Link>
              </Button>
            )}
          </>
        }
      />

      <p className="font-mono text-xs text-muted-foreground">
        {session.repoUrl}
        {session.branch ? ` · branch: ${session.branch}` : ""}
      </p>

      {phase === "running" && (
        <LoadingProgress
          title="Cleanup pipeline"
          steps={[
            { id: "select", label: "Selecting safe findings" },
            { id: "patch", label: "Generating changes" },
            { id: "verify", label: "Validating patch" },
          ]}
          currentIndex={1}
        />
      )}

      {error && (
        <ErrorState
          title="Cleanup failed"
          message="Retry or return to findings to adjust selection."
          technicalDetail={error}
          actions={[{ label: "Retry", onClick: runCleanup }]}
        />
      )}

      {!result && phase !== "running" && (
        <Panel variant="elevated" padding="md">
          <p className="ds-label mb-3">Select one finding (free proof)</p>
          <p className="mb-4 text-sm text-muted-foreground">
            Selected: {selectedIds.length}/{FREE_CLEANUP_LIMIT}
          </p>
          <ul className="max-h-80 space-y-2 overflow-y-auto scrollbar-thin">
            {eligibleForSelection.slice(0, 30).map((f) => (
              <FindingSelectRow
                key={f.id}
                finding={f}
                checked={selectedIds.includes(f.id)}
                disabled={
                  !selectedIds.includes(f.id) && selectedIds.length >= FREE_CLEANUP_LIMIT
                }
                onToggle={() => toggle(f.id)}
              />
            ))}
          </ul>
          {eligibleForSelection.length === 0 && (
            <FeedbackBanner
              variant="warning"
              message="RepoDiet did not find an issue safe enough to modify automatically on this repository."
              dismissible={false}
            />
          )}
        </Panel>
      )}

      {result && (
        <>
          <FeedbackBanner
            variant={result.patchStatus === "validated" ? "success" : "info"}
            message={result.verifiedLabel}
            dismissible={false}
          />

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Findings selected" value={result.fixLoop.selected} />
            <Metric label="Verified & retained" value={result.fixLoop.verified} />
            <Metric label="Skipped" value={result.fixLoop.skipped} />
            <Metric label="Rejected" value={result.fixLoop.rejected} />
          </div>

          {result.fixLoop.attempts.length > 0 && (
            <Panel variant="elevated" padding="md">
              <p className="ds-label mb-3">Fix loop</p>
              <ul className="space-y-2 text-sm">
                {result.fixLoop.attempts.map((a) => (
                  <li key={a.findingId} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 truncate">{a.title}</span>
                    <RiskBadge
                      level={
                        a.status === "verified"
                          ? "safe"
                          : a.status === "rejected"
                            ? "danger"
                            : "review"
                      }
                    >
                      {a.status}
                    </RiskBadge>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Files changed" value={result.metrics.filesChanged} />
            <Metric label="Lines removed" value={result.metrics.linesRemoved} />
            <Metric label="Lines added" value={result.metrics.linesAdded} />
          </div>

          {result.unifiedDiff && (
            <Panel variant="elevated" padding="md">
              <p className="ds-label mb-3">Unified diff</p>
              <pre className="max-h-96 overflow-auto rounded border border-border/40 bg-[#05080D]/60 p-3 font-mono text-[10px] text-muted-foreground scrollbar-thin">
                {result.unifiedDiff}
              </pre>
            </Panel>
          )}

          {result.verification.baselineSummary && result.verification.baselineSummary.length > 0 && (
            <Panel variant="elevated" padding="md">
              <p className="ds-label mb-3">Baseline verification</p>
              <pre className="whitespace-pre-wrap text-sm text-muted-foreground">
                {result.verification.baselineSummary.join("\n")}
              </pre>
            </Panel>
          )}
          {result.verification.checks.length > 0 && (
            <Panel variant="elevated" padding="md">
              <p className="ds-label mb-3 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" aria-hidden />
                Verification
              </p>
              <ul className="space-y-2">
                {result.verification.checks.map((check) => (
                  <li key={check.name} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>{check.name}</span>
                    <RiskBadge
                      level={
                        check.status === "passed"
                          ? "safe"
                          : check.status === "failed"
                            ? "danger"
                            : "review"
                      }
                    >
                      {check.status.replace("_", " ")}
                    </RiskBadge>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {result.limitations.length > 0 && (
            <Panel variant="elevated" padding="md">
              <p className="ds-label mb-2">Limitations</p>
              <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                {result.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-border/40 bg-card/40 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function FindingSelectRow({
  finding,
  checked,
  disabled,
  onToggle,
}: {
  finding: Finding;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="flex items-start gap-3 rounded border border-border/30 p-2">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
        className="mt-1"
        aria-label={`Select ${finding.title}`}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{finding.title}</p>
        <p className="truncate font-mono text-[10px] text-muted-foreground">
          {finding.files.join(", ") || finding.packageName}
        </p>
        <p className="text-[10px] text-muted-foreground">{eligibilityReason(finding)}</p>
      </div>
      <RiskBadge level={finding.action === "safe_candidate" ? "safe" : "review"}>
        {finding.sourceMode}
      </RiskBadge>
    </li>
  );
}
