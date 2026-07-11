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
import { PRODUCT_OUTCOME_LABELS } from "@/lib/execution/outcomes";
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

  const primaryAttempt = result?.fixLoop.attempts[0];

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
    show("info", "Running free proof in isolated workspace…");

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
      if (!json.success) throw new Error(json.error ?? "Free proof failed.");
      setResult(json.cleanup as FreeCleanupResult);
      setPhase("complete");
      show("success", json.cleanup.verifiedLabel ?? "Free proof complete");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Cleanup failed.";
      setError(msg);
      setPhase("failed");
      show("error", "Free proof failed");
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
        title="Free Cleanup Run"
        description={
          cta.mode === "auto_fix"
            ? "RepoDiet ranks eligible findings, runs every supported transformer with deterministic strategies, verifies each change, and shows exact evidence. Your GitHub repository is not modified."
            : "No findings met Phase 1 automatic-fix eligibility. RepoDiet will explain why — no fake changes."
        }
        actions={
          <>
            <Button onClick={runCleanup} disabled={!canRun || phase === "running"}>
              {phase === "running" ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden />
                  Running backend pipeline…
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
        {findings.repo.commitSha ? ` · ${findings.repo.commitSha.slice(0, 7)}` : ""}
      </p>

      {phase === "running" && (
        <Panel variant="elevated" padding="md">
          <p className="ds-label mb-2">Cleanup pipeline</p>
          <p className="text-sm text-muted-foreground">
            Executing on the server: workspace preparation → baseline checks → fix generation →
            patch validation → verification. Results appear when the backend completes.
          </p>
        </Panel>
      )}

      {error && (
        <ErrorState
          title="Free proof failed"
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
              message="RepoDiet did not find a Phase 1 eligible issue (unused import, unused dependency with native evidence, or obvious temp file)."
              dismissible={false}
            />
          )}
        </Panel>
      )}

      {result && (
        <>
          <FeedbackBanner
            variant={result.proof.finalDecision === "verified_fix" ? "success" : "info"}
            message={result.verifiedLabel}
            dismissible={false}
          />

          <Panel variant="elevated" padding="md">
            <p className="ds-label mb-3">Final outcome</p>
            <p className="text-lg font-semibold">
              {PRODUCT_OUTCOME_LABELS[
                result.proof.productOutcome as keyof typeof PRODUCT_OUTCOME_LABELS
              ] ?? result.proof.finalDecision.replace(/_/g, " ")}
            </p>
            <p className="mt-2 text-sm text-foreground">{result.verifiedLabel}</p>
            {findings.repo.commitSha && (
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                Scanned commit: {findings.repo.commitSha}
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              GitHub repository was not modified — isolated workspace only.
            </p>
          </Panel>

          {result.fixLoop.attempts.length > 0 && (
            <Panel variant="elevated" padding="md">
              <p className="ds-label mb-3">
                Candidate attempts ({result.fixLoop.evaluated ?? result.fixLoop.attempts.length}{" "}
                evaluated
                {(result.fixLoop.notAttempted ?? 0) > 0
                  ? `, ${result.fixLoop.notAttempted} not attempted`
                  : ""}
                )
              </p>
              <ul className="space-y-3">
                {result.fixLoop.attempts.map((attempt, idx) => (
                  <li
                    key={`${attempt.findingId}-${idx}`}
                    className="rounded border border-border/40 p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        Candidate {idx + 1}: {attempt.title}
                      </span>
                      <RiskBadge
                        level={
                          attempt.productOutcome === "verified_fix" || attempt.status === "retained"
                            ? "safe"
                            : attempt.status === "rejected"
                              ? "danger"
                              : "review"
                        }
                      >
                        {attempt.productOutcome
                          ? PRODUCT_OUTCOME_LABELS[
                              attempt.productOutcome as keyof typeof PRODUCT_OUTCOME_LABELS
                            ]
                          : attempt.status}
                      </RiskBadge>
                    </div>
                    <p className="mt-2 text-muted-foreground">
                      {attempt.exactReason || attempt.displayReason || attempt.reason}
                    </p>
                    <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                      {attempt.pluginId}
                      {attempt.strategyId ? ` · ${attempt.strategyId}` : ""}
                      {attempt.rollbackStatus ? ` · rollback ${attempt.rollbackStatus}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
              {result.proof.finalDecision !== "verified_fix" && (
                <p className="mt-3 text-sm text-muted-foreground">{result.verifiedLabel}</p>
              )}
            </Panel>
          )}

          {result.healthImpact && (
            <Panel variant="elevated" padding="md">
              <p className="ds-label mb-3">Verified health impact</p>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {result.healthImpact.summaryLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </Panel>
          )}

          {primaryAttempt && (
            <Panel variant="elevated" padding="md">
              <p className="ds-label mb-3">Finding selected</p>
              <p className="font-medium">{primaryAttempt.title}</p>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Expected fix</dt>
                  <dd>{primaryAttempt.expectedFix}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Plugin</dt>
                  <dd className="font-mono text-xs">{primaryAttempt.pluginId}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">Why eligible</dt>
                  <dd>{primaryAttempt.eligibilityReason}</dd>
                </div>
              </dl>
            </Panel>
          )}

          {primaryAttempt &&
            Object.entries(primaryAttempt.originalSources).map(([path, source]) => {
              const modified = primaryAttempt.modifiedSources[path];
              const hasVerifiedChange =
                Boolean(result.unifiedDiff) &&
                Boolean(modified) &&
                modified !== source;
              return (
              <Panel key={path} variant="elevated" padding="md">
                <p className="ds-label mb-2">Original source — {path}</p>
                <pre className="max-h-48 overflow-auto rounded border border-border/40 bg-[#05080D]/60 p-3 font-mono text-[10px] text-muted-foreground scrollbar-thin">
                  {source || "(file deleted)"}
                </pre>
                {hasVerifiedChange ? (
                  <>
                    <p className="ds-label mb-2 mt-4">Modified source</p>
                    <pre className="max-h-48 overflow-auto rounded border border-border/40 bg-[#05080D]/60 p-3 font-mono text-[10px] text-muted-foreground scrollbar-thin">
                      {modified}
                    </pre>
                  </>
                ) : (
                  <p className="mt-4 text-sm text-muted-foreground">
                    {primaryAttempt.exactReason ||
                      primaryAttempt.displayReason ||
                      "No verified source modification was retained for this attempt."}
                  </p>
                )}
              </Panel>
              );
            })}

          {result.unifiedDiff && (
            <Panel variant="elevated" padding="md">
              <p className="ds-label mb-3">Unified diff</p>
              <pre className="max-h-96 overflow-auto rounded border border-border/40 bg-[#05080D]/60 p-3 font-mono text-[10px] text-muted-foreground scrollbar-thin">
                {result.unifiedDiff}
              </pre>
            </Panel>
          )}

          {result.stateTransitions && result.stateTransitions.length > 0 && (
            <Panel variant="elevated" padding="md">
              <p className="ds-label mb-3">Backend state machine</p>
              <ul className="space-y-1 font-mono text-[10px] text-muted-foreground">
                {result.stateTransitions.map((t, i) => (
                  <li key={`${t.state}-${i}`}>
                    {t.state}
                    {t.detail ? ` — ${t.detail}` : ""}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {result.verification.baselineSummary && (
            <Panel variant="elevated" padding="md">
              <p className="ds-label mb-3">Baseline verification</p>
              <pre className="whitespace-pre-wrap text-sm text-muted-foreground">
                {result.verification.baselineSummary.join("\n")}
              </pre>
            </Panel>
          )}

          {primaryAttempt && primaryAttempt.comparison.length > 0 && (
            <Panel variant="elevated" padding="md">
              <p className="ds-label mb-3">Comparison</p>
              <ul className="space-y-2 text-sm">
                {primaryAttempt.comparison.map((c) => (
                  <li key={c.name} className="flex flex-wrap justify-between gap-2">
                    <span>{c.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      exit {c.exitCode ?? "n/a"} — {c.outcome}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {result.proof.executedCommands.length > 0 && (
            <Panel variant="elevated" padding="md">
              <p className="ds-label mb-3 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" aria-hidden />
                Executed commands
              </p>
              <ul className="space-y-2">
                {result.proof.executedCommands.map((check) => (
                  <li key={check.name} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="font-mono text-xs">{check.command || check.name}</span>
                    <RiskBadge
                      level={
                        check.status === "passed"
                          ? "safe"
                          : check.status === "failed"
                            ? "danger"
                            : "review"
                      }
                    >
                      exit {check.exitCode ?? "n/a"} — {check.status}
                    </RiskBadge>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}
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
