"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppSession } from "@/components/app/app-session";
import { LockedTab, WorkspaceSection } from "@/components/app/locked-tab";
import { SummaryCards } from "./findings/summary-cards";
import { AnalyzerSourcesPanel } from "./findings/analyzer-sources-panel";
import { RiskSummaryPanel } from "./findings/risk-summary-panel";
import { FindingsWorkspace } from "./findings/findings-workspace";
import { FindingsProgressionBanner } from "./findings/findings-progression-banner";
import { DeveloperToolsA2Mcp } from "@/components/app/developer-tools-a2mcp";
import { RepositoryMap } from "./findings/repository-map";
import { JsonExportCard } from "./findings/json-export";
import {
  FINDINGS_STEPS,
  buildCleanupPrompt,
  clearPersistedAnalysisJob,
  flattenFindings,
  loadPersistedAnalysisJob,
  runFindingsAnalysis,
  type FindingsJobAccepted,
  type FindingsJobProgress,
  type FindingsPhase,
} from "@/lib/findings/client";
import type { AnalysisErrorContract } from "@/lib/findings/analysis-errors";
import { LoadingProgress } from "@/components/app/ui/loading-progress";
import { ErrorState } from "@/components/app/ui/error-state";
import { EmptyState } from "@/components/app/ui/empty-state";
import { FeedbackBanner } from "@/components/app/ui/feedback-banner";
import { useFeedbackToast } from "@/components/app/ui/feedback-banner";
import { DEMO_NOTICE } from "@/lib/demo/constants";
import { FileSearch } from "lucide-react";
import { Panel } from "@/components/design-system/panel";
import { ProjectRootPanel } from "./findings/project-root-panel";
import { AnalysisLineageBanner } from "@/components/app/analysis-lineage-banner";
import { computeWorkflowGates } from "@/lib/workflow/gates";
import { findingsAnalyzerWarning } from "@/lib/findings/analyzer-status";
import { isActionableFinding } from "@/lib/findings/actionability-signals";

const LOADING: FindingsPhase[] = [
  "queued",
  "dispatching",
  "dispatched",
  "waiting_runner",
  "claimed",
  "inventory",
  "resolving",
  "graph",
  "analyzers",
  "normalizing",
  "validating",
  "baseline",
];

function phaseIndex(phase: FindingsPhase): number {
  if (phase === "idle" || phase === "failed") return -1;
  return FINDINGS_STEPS.findIndex((s) => s.phase === phase);
}

function isAnalysisError(err: unknown): err is AnalysisErrorContract {
  return Boolean(err && typeof err === "object" && "code" in err && "requestId" in err);
}

export function FindingsTab() {
  const searchParams = useSearchParams();
  const {
    session,
    findings,
    setFindings,
    selectedFindingIds,
    toggleFindingSelection,
    selectAllSafeFindings,
    clearFindingSelection,
    setSelectedFindingIds,
  } = useAppSession();
  const { show, Toast } = useFeedbackToast();
  const [phase, setPhase] = useState<FindingsPhase>("idle");
  const [error, setError] = useState<AnalysisErrorContract | null>(null);
  const [accepted, setAccepted] = useState<FindingsJobAccepted | null>(null);
  const [progress, setProgress] = useState<FindingsJobProgress | null>(null);
  const [promptCopied, setPromptCopied] = useState(false);
  const [inFlight, setInFlight] = useState(false);
  const demoAutoStarted = useRef(false);
  const resumeStarted = useRef(false);
  const isDemoMode = searchParams.get("demo") === "true" || searchParams.get("demo") === "1";

  const isLoading = LOADING.includes(phase) || inFlight;
  const currentStep = phaseIndex(phase);
  const structureScanId = session.scanRecordId ?? session.scanResult?.id;

  const runFindings = useCallback(async () => {
    if (!session.scanComplete || !session.repoUrl || !structureScanId) return;
    if (inFlight) return;
    setInFlight(true);
    setError(null);
    show("info", "Findings analysis queued");

    try {
      const result = await runFindingsAnalysis(
        session.repoUrl,
        session.branch || undefined,
        setPhase,
        structureScanId,
        session.selectedProjectRoot,
        {
          sourceCommit: session.scanResult?.repo.commitSha,
          onAccepted: (job) => {
            setAccepted(job);
            if (job.dispatcherReady || job.workerMode === "github_actions_on_demand") {
              show("info", "Starting secure analysis worker on GitHub Actions.");
            } else if (!job.workerReady) {
              show(
                "info",
                "Queued — configure Actions dispatch to start a free GitHub analysis worker."
              );
            }
          },
          onProgress: setProgress,
        }
      );
      setFindings(result);
      show("success", "Findings ready — review classification");
    } catch (err) {
      const contract = isAnalysisError(err)
        ? err
        : ({
            code: "INTERNAL_ERROR",
            message: err instanceof Error ? err.message : "Findings analysis failed.",
            retryable: true,
            paymentState: "not_required" as const,
            requestId: "unknown",
            requiredAction: "RETRY",
            structureScanId,
          } satisfies AnalysisErrorContract);
      setPhase("failed");
      setError(contract);
      show("error", `${contract.code}: analysis needs attention`);
    } finally {
      setInFlight(false);
    }
  }, [session, setFindings, show, structureScanId, inFlight]);

  useEffect(() => {
    if (resumeStarted.current || findings || !structureScanId) return;
    const persisted = loadPersistedAnalysisJob(structureScanId);
    if (!persisted) return;
    resumeStarted.current = true;
    void runFindings();
  }, [structureScanId, findings, runFindings]);

  useEffect(() => {
    if (
      isDemoMode &&
      session.scanComplete &&
      !findings &&
      phase === "idle" &&
      !demoAutoStarted.current
    ) {
      demoAutoStarted.current = true;
      void runFindings();
    }
  }, [isDemoMode, session.scanComplete, findings, phase, runFindings]);

  const copyPrompt = async () => {
    if (!findings) return;
    await navigator.clipboard.writeText(buildCleanupPrompt(findings));
    setPromptCopied(true);
    show("success", "Cleanup prompt copied");
    setTimeout(() => setPromptCopied(false), 2000);
  };

  const downloadFindings = () => {
    if (!findings) return;
    const json = JSON.stringify(findings, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `repodiet-findings-${findings.scanId}.json`;
    a.click();
    URL.revokeObjectURL(url);
    show("success", "findings.json downloaded");
  };

  const gates = computeWorkflowGates({
    scanComplete: session.scanComplete,
    projectRootConfirmed: session.projectRootConfirmed,
    findings,
    patchKit: null,
  });

  if (!gates.findingsUnlocked) {
    const connected = Boolean(session.scanComplete && session.scanResult?.repo?.commitSha);
    return (
      <LockedTab
        step="02"
        title="Findings Engine"
        description={
          connected && !session.projectRootConfirmed
            ? "Select which application RepoDiet should analyze on the Scan tab before running findings."
            : "Review Findings becomes available after RepoDiet successfully scans and pins the repository commit."
        }
      />
    );
  }

  const allFindings = findings ? flattenFindings(findings) : [];
  const supportedCount = allFindings.filter(isActionableFinding).length;

  return (
    <div className="space-y-6">
      {Toast}

      {isDemoMode && (
        <FeedbackBanner variant="info" message={DEMO_NOTICE} dismissible={false} />
      )}

      <WorkspaceSection
        label="Analysis workspace"
        title="Findings Engine"
        description="Run Findings enqueues a durable analysis job. Analyzers run on the RepoDiet worker — not inside one browser request."
        actions={
          <>
            <Button onClick={runFindings} disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden />
                  {phase === "waiting_runner" || phase === "dispatched" || phase === "dispatching"
                    ? "Starting worker…"
                    : accepted && phase === "queued"
                      ? "Queued…"
                      : "Analyzing…"}
                </>
              ) : findings ? (
                "Re-run Findings"
              ) : (
                "Run Findings"
              )}
            </Button>
            {findings && gates.quickCleanupAvailable && (
              <Button asChild>
                <Link href="/app?tab=patch">Continue to Quick Cleanup</Link>
              </Button>
            )}
            <details className="relative">
              <summary className="cursor-pointer list-none rounded-md border border-border/40 px-3 py-2 text-sm text-muted-foreground hover:bg-card-elevated">
                Developer tools
              </summary>
              <div className="absolute right-0 z-10 mt-2 flex min-w-[200px] flex-col gap-1 rounded-md border border-border/60 bg-card p-2 shadow-lg">
                <Button variant="secondary" size="sm" disabled={!findings} onClick={downloadFindings}>
                  Download findings.json
                </Button>
                <Button variant="outline" size="sm" disabled={!findings} onClick={copyPrompt}>
                  <Copy className="h-4 w-4" aria-hidden />
                  {promptCopied ? "Copied" : "Copy Cleanup Prompt"}
                </Button>
              </div>
            </details>
          </>
        }
      />

      <p className="font-mono text-xs text-muted-foreground">
        {session.repoUrl}
        {session.branch ? ` · branch: ${session.branch}` : ""}
        {structureScanId ? ` · scan: ${structureScanId}` : ""}
      </p>

      {accepted &&
        isLoading &&
        (phase === "dispatching" ||
          phase === "dispatched" ||
          phase === "waiting_runner" ||
          (phase === "queued" && accepted.dispatcherReady)) && (
        <FeedbackBanner
          variant="info"
          message="Starting secure analysis worker — waiting for GitHub Actions runner. Refresh anytime to resume."
          dismissible={false}
        />
      )}

      {(isLoading || accepted) && !findings && (
        <Panel variant="elevated" padding="md" className="space-y-3 border-border/60">
          <p className="ds-label">Durable analysis progress</p>
          <p className="text-sm font-medium text-foreground">
            {phase === "waiting_runner" || progress?.stage === "WAITING_FOR_RUNNER"
              ? "Waiting for GitHub Actions runner"
              : phase === "dispatched" || progress?.stage === "DISPATCHED"
                ? "GitHub worker requested"
                : phase === "dispatching" || progress?.stage === "DISPATCHING"
                  ? "Starting secure analysis worker"
                  : `Stage: ${progress?.stage ?? accepted?.stage ?? phase}`}
          </p>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Job ID</dt>
              <dd className="font-mono text-xs">{accepted?.jobId ?? progress?.jobId ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Source commit</dt>
              <dd className="font-mono text-xs">
                {(
                  progress?.sourceCommit ??
                  session.scanResult?.repo.commitSha ??
                  "—"
                ).toString().slice(0, 12)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Worker mode</dt>
              <dd className="font-mono text-xs">
                {accepted?.workerMode ?? progress?.workerMode ?? "github_actions_on_demand"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">dispatcherReady</dt>
              <dd className="font-mono text-xs">
                {accepted ? String(Boolean(accepted.dispatcherReady ?? accepted.workerReady)) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Retryable</dt>
              <dd className="font-mono text-xs">
                {error ? String(error.retryable) : "true (durable job)"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Elapsed</dt>
              <dd className="font-mono text-xs">
                {progress?.createdAt
                  ? `${Math.max(0, Math.floor((Date.now() - Date.parse(progress.createdAt)) / 1000))}s`
                  : accepted
                    ? "polling…"
                    : "—"}
              </dd>
            </div>
            {(progress?.workflowRunId || accepted?.workflowRunId) && (
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Workflow run</dt>
                <dd className="break-all font-mono text-xs">
                  {progress?.workflowRunUrl || accepted?.workflowRunUrl ? (
                    <a
                      href={progress?.workflowRunUrl || accepted?.workflowRunUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      {progress?.workflowRunId || accepted?.workflowRunId}
                    </a>
                  ) : (
                    progress?.workflowRunId || accepted?.workflowRunId
                  )}
                </dd>
              </div>
            )}
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Status URL</dt>
              <dd className="break-all font-mono text-xs">{accepted?.statusUrl ?? "—"}</dd>
            </div>
            {accepted?.requestId ? (
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Request ID</dt>
                <dd className="font-mono text-xs">{accepted.requestId}</dd>
              </div>
            ) : null}
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                clearPersistedAnalysisJob();
                setAccepted(null);
                setProgress(null);
                setPhase("idle");
                setInFlight(false);
                if (accepted?.jobId) {
                  void fetch(`/api/deep-scans/${accepted.jobId}/cancel`, {
                    method: "POST",
                    credentials: "same-origin",
                  }).catch(() => undefined);
                }
                show("info", "Analysis cancelled locally — durable job marked cancelled when owned");
              }}
            >
              Cancel
            </Button>
          </div>
        </Panel>
      )}

      {isLoading && (
        <LoadingProgress
          title="Analysis pipeline"
          steps={FINDINGS_STEPS.filter((s) => s.phase !== "ready").map((s) => ({
            id: s.phase,
            label: s.label,
          }))}
          currentIndex={currentStep}
        />
      )}

      {error && (
        <ErrorState
          title={
            error.code === "WORKER_UNAVAILABLE"
              ? "Analysis worker unavailable"
              : "Findings analysis needs attention"
          }
          message={error.message}
          technicalDetail={`code=${error.code}; requestId=${error.requestId}${
            error.jobId ? `; jobId=${error.jobId}` : ""
          }${error.statusUrl ? `; statusUrl=${error.statusUrl}` : ""}${
            error.requiredAction ? `; requiredAction=${error.requiredAction}` : ""
          }`}
          actions={[
            {
              label: error.retryable ? "Resume / Retry" : "Back to Scan",
              onClick: error.retryable
                ? runFindings
                : () => {
                    clearPersistedAnalysisJob();
                    window.location.href = "/app?tab=scan";
                  },
            },
          ]}
        />
      )}

      {findings && (
        <>
          <AnalysisLineageBanner scan={session.scanResult} findings={findings} />

          {(() => {
            const warning = findingsAnalyzerWarning(findings.rawToolReports);
            return warning ? (
              <FeedbackBanner variant="warning" message={warning} dismissible={false} />
            ) : null;
          })()}

          {findings.scanCoverageWarning && (
            <FeedbackBanner
              variant="warning"
              message={findings.scanCoverageWarning}
              dismissible={false}
            />
          )}

          {findings.summary.confidenceTiers && (
            <Panel variant="elevated" padding="sm" className="border-border/60">
              <p className="ds-label mb-2">Evidence confidence tiers</p>
              <p className="mb-3 text-xs text-muted-foreground">
                Findings are ranked by priority (confidence × reachability × exposure × blast radius ×
                maintenance × recurrence × fix safety), not severity alone.
              </p>
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">Verified</dt>
                  <dd className="font-mono text-lg text-signal">
                    {findings.summary.confidenceTiers.verified}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">High confidence</dt>
                  <dd className="font-mono text-lg">
                    {findings.summary.confidenceTiers.highConfidence}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Needs review</dt>
                  <dd className="font-mono text-lg text-amber-400">
                    {findings.summary.confidenceTiers.needsReview}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Suppressed</dt>
                  <dd className="font-mono text-lg text-muted-foreground">
                    {findings.summary.confidenceTiers.suppressed}
                  </dd>
                </div>
              </dl>
            </Panel>
          )}

          {findings.mode === "demo" && (
            <FeedbackBanner
              variant="info"
              message="DEMO REPOSITORY — findings are from the seeded demo workspace."
              dismissible={false}
            />
          )}

          <FindingsProgressionBanner
            findings={findings}
            selectedCount={selectedFindingIds.length}
            onSelectAllSafe={selectAllSafeFindings}
            onClearSelection={clearFindingSelection}
          />

          <SummaryCards payload={findings} />
          <AnalyzerSourcesPanel payload={findings} />
          <ProjectRootPanel payload={findings} />
          <RiskSummaryPanel summary={findings.summary} />
          <RepositoryMap findings={allFindings} />
          <FindingsWorkspace
            findings={allFindings}
            rawToolReports={findings.rawToolReports}
            selectedForPatch={selectedFindingIds}
            onTogglePatchSelection={toggleFindingSelection}
            onClearSelection={clearFindingSelection}
            onSelectFindingIds={setSelectedFindingIds}
          />
          <JsonExportCard payload={findings} />
          <DeveloperToolsA2Mcp />

          <PanelCTA findings={allFindings} supportedCount={supportedCount} />
        </>
      )}

      {!findings && !isLoading && !error && (
        <EmptyState
          icon={FileSearch}
          title="Ready for findings analysis"
          description="Structure scan finished. Run the Findings Engine to detect duplicates, unused code, orphan patterns, and AI-slop signals."
          action={{ label: "Run Findings Engine", onClick: runFindings }}
        />
      )}
    </div>
  );
}

function PanelCTA({
  findings,
  supportedCount,
}: {
  findings: import("@/lib/findings/types").Finding[];
  supportedCount: number;
}) {
  if (supportedCount > 0) {
    return (
      <Panel variant="elevated" padding="md">
        <p className="ds-label mb-2">Automatic cleanup available</p>
        <p className="mb-4 text-sm text-muted-foreground">
          {supportedCount} finding{supportedCount === 1 ? "" : "s"} passed eligibility preflight and
          can be included in a paid A2A cleanup pull request.
        </p>
        <Button asChild>
          <Link href="/app?tab=patch">Review cleanup scope</Link>
        </Button>
      </Panel>
    );
  }

  return (
    <Panel variant="elevated" padding="md">
      <p className="ds-label mb-2">No findings are ready for automatic cleanup</p>
      <p className="mb-4 text-sm text-muted-foreground">
        RepoDiet found issues, but none currently have enough evidence for an automatic change.
        Review a finding, run eligibility preflight, or reconnect GitHub if repository access is
        missing.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" asChild>
          <Link href="/app?tab=findings#workspace">Review eligibility</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/app?tab=findings">Re-run findings</Link>
        </Button>
      </div>
    </Panel>
  );
}
