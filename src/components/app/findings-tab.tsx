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
import { RepositoryCoveragePanel } from "./findings/repository-coverage-panel";
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
import { isCleanupEligible } from "@/lib/findings/cleanup-eligibility";
import { FindingsAccordion } from "./findings/findings-accordion";
import { countCleanupEligible } from "@/lib/findings/cleanup-eligibility";

const LOADING: FindingsPhase[] = [
  "queued",
  "dispatching",
  "dispatched",
  "waiting_runner",
  "claimed",
  "preparing_archive",
  "downloading_archive",
  "archive_ready",
  "inventory",
  "resolving",
  "graph",
  "running_jscpd",
  "running_knip",
  "running_madge",
  "running_heuristics",
  "analyzers",
  "normalizing",
  "validating",
  "persisting",
  "baseline",
];

function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}m ${rem}s`;
}

function stageDisplayLabel(stage: string | undefined, phase: FindingsPhase): string {
  const labels: Record<string, string> = {
    QUEUED: "Queued",
    DISPATCHING: "Starting secure analysis worker",
    DISPATCHED: "GitHub worker requested",
    WAITING_FOR_RUNNER: "Waiting for GitHub Actions runner",
    CLAIMED: "Claimed by GitHub runner",
    PREPARING_ARCHIVE: "Preparing repository archive",
    DOWNLOADING_ARCHIVE: "Downloading commit-pinned source",
    ARCHIVE_READY: "Repository archive ready",
    INVENTORY: "Inventorying files",
    RESOLVING_PROJECTS: "Resolving project roots",
    BUILDING_GRAPH: "Building repository graph",
    RUNNING_JSCpd: "Running duplicate detection (jscpd)",
    RUNNING_KNIP: "Running unused-code analysis (Knip)",
    RUNNING_MADGE: "Running dependency graph analysis (Madge)",
    RUNNING_INTERNAL_HEURISTICS: "Running internal heuristics",
    RUNNING_ANALYZERS: "Running analyzers",
    NORMALIZING_FINDINGS: "Normalizing findings",
    VALIDATING_EVIDENCE: "Validating finding evidence",
    PERSISTING_RESULTS: "Saving repository graph and findings",
    WORKER_STALLED: "Worker stalled — retry available",
    READY: "Ready",
  };
  if (stage && labels[stage]) return labels[stage];
  return `Stage: ${stage ?? phase}`;
}

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
  const supportedCount =
    findings?.summary.eligibleFindings ?? countCleanupEligible(allFindings);
  const selectedEligibleCount = allFindings.filter(
    (f) => selectedFindingIds.includes(f.id) && isCleanupEligible(f)
  ).length;

  const now = Date.now();
  const totalElapsedMs = progress?.createdAt
    ? now - Date.parse(progress.createdAt)
    : accepted
      ? 0
      : 0;
  const stageStartedAt = progress?.stageStartedAt ?? progress?.updatedAt;
  const stageElapsedMs = stageStartedAt ? now - Date.parse(stageStartedAt) : 0;
  const lastActivityAt = progress?.lastActivityAt ?? progress?.heartbeatAt ?? progress?.updatedAt;
  const lastActivityAgeMs = lastActivityAt ? now - Date.parse(lastActivityAt) : null;
  const showStillActive =
    isLoading &&
    stageElapsedMs >= 45_000 &&
    lastActivityAgeMs != null &&
    lastActivityAgeMs < 120_000;

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
            {findings && gates.quickCleanupAvailable && selectedEligibleCount > 0 && (
              <Button asChild>
                <Link href="/app?tab=patch">Continue to Quick Cleanup</Link>
              </Button>
            )}
            {findings && (!gates.quickCleanupAvailable || selectedEligibleCount === 0) && (
              <Button variant="secondary" disabled>
                Continue to Quick Cleanup
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
            {stageDisplayLabel(progress?.stage ?? accepted?.stage, phase)}
          </p>
          {progress?.progressMessage || progress?.progress?.message || progress?.progress?.detail ? (
            <p className="text-sm text-muted-foreground">
              {progress.progressMessage ||
                progress.progress?.message ||
                progress.progress?.detail}
            </p>
          ) : null}
          {showStillActive && (
            <FeedbackBanner
              variant="info"
              message="Analysis is still active. Large repositories can take longer to prepare and inspect."
              dismissible={false}
            />
          )}
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Current stage</dt>
              <dd className="font-mono text-xs">{progress?.stage ?? accepted?.stage ?? phase}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Elapsed total</dt>
              <dd className="font-mono text-xs">{formatElapsed(totalElapsedMs)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Elapsed current stage</dt>
              <dd className="font-mono text-xs">{formatElapsed(stageElapsedMs)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Last worker activity</dt>
              <dd className="font-mono text-xs">
                {lastActivityAt
                  ? `${formatElapsed(lastActivityAgeMs ?? 0)} ago`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Job ID</dt>
              <dd className="font-mono text-xs">{accepted?.jobId ?? progress?.jobId ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Repository</dt>
              <dd className="font-mono text-xs">{session.repoUrl || "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Pinned commit</dt>
              <dd className="font-mono text-xs">
                {(
                  progress?.sourceCommit ??
                  session.scanResult?.repo.commitSha ??
                  "—"
                )
                  .toString()
                  .slice(0, 12)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Files processed</dt>
              <dd className="font-mono text-xs">
                {progress?.completedUnits != null
                  ? progress.totalUnits != null
                    ? `${progress.completedUnits} / ${progress.totalUnits}`
                    : String(progress.completedUnits)
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Analyzer</dt>
              <dd className="font-mono text-xs">
                {String(progress?.stage ?? "").startsWith("RUNNING_")
                  ? String(progress?.stage).replace("RUNNING_", "")
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Worker identity</dt>
              <dd className="font-mono text-xs">
                {progress?.workerIdentity ?? progress?.claimedBy ?? progress?.workerHost ?? "—"}
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
              <dt className="text-muted-foreground">Durable status URL</dt>
              <dd className="break-all font-mono text-xs">{accepted?.statusUrl ?? "—"}</dd>
            </div>
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
          <Panel variant="elevated" padding="md" className="border-border/60">
            <p className="ds-label mb-1">Repository</p>
            <p className="font-mono text-sm">
              {findings.repo.owner}/{findings.repo.name}
              {findings.repo.commitSha
                ? ` @ ${findings.repo.commitSha.slice(0, 12)}`
                : ""}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {findings.summary.totalFindings} findings ·{" "}
              {findings.summary.safeCandidates} safe · {findings.summary.reviewRequired} review ·{" "}
              {findings.summary.doNotTouch} protected · {supportedCount} cleanup-eligible
            </p>
          </Panel>

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

          {findings.mode === "demo" && (
            <FeedbackBanner
              variant="info"
              message="DEMO REPOSITORY — findings are from the seeded demo workspace."
              dismissible={false}
            />
          )}

          <FindingsProgressionBanner
            findings={findings}
            selectedCount={selectedEligibleCount}
            onSelectAllSafe={selectAllSafeFindings}
            onClearSelection={clearFindingSelection}
          />

          <RepositoryCoveragePanel coverage={findings.universalCoverage} />

          <SummaryCards payload={findings} />

          <FindingsAccordion title="View analysis details" summary="Lineage, sources, project roots">
            <div className="space-y-3">
              <AnalysisLineageBanner scan={session.scanResult} findings={findings} />
              <FindingsAccordion title="View analyzer evidence" defaultOpen={false}>
                <AnalyzerSourcesPanel payload={findings} />
              </FindingsAccordion>
              <FindingsAccordion title="Project roots" defaultOpen={false}>
                <ProjectRootPanel payload={findings} />
              </FindingsAccordion>
            </div>
          </FindingsAccordion>

          <FindingsAccordion title="View analyzer evidence" summary="Confidence tiers and risk">
            <div className="space-y-3">
              {findings.summary.confidenceTiers && (
                <Panel variant="elevated" padding="sm" className="border-border/60">
                  <p className="ds-label mb-2">Evidence confidence tiers</p>
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
              <RiskSummaryPanel summary={findings.summary} />
            </div>
          </FindingsAccordion>

          <FindingsAccordion title="View repository map" defaultOpen={false}>
            <RepositoryMap findings={allFindings} />
          </FindingsAccordion>

          <FindingsWorkspace
            findings={allFindings}
            rawToolReports={findings.rawToolReports}
            selectedForPatch={selectedFindingIds}
            onTogglePatchSelection={toggleFindingSelection}
            onClearSelection={clearFindingSelection}
            onSelectFindingIds={setSelectedFindingIds}
          />

          <FindingsAccordion title="Developer diagnostics" defaultOpen={false}>
            <div className="space-y-3">
              <JsonExportCard payload={findings} />
              <DeveloperToolsA2Mcp />
            </div>
          </FindingsAccordion>

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
