"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Github, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel } from "@/components/design-system/panel";
import type { ScanPayload } from "@/lib/scanner/run-scan";
import { DEMO_NOTICE } from "@/lib/demo/constants";
import {
  type ScanPhase,
  SCAN_STEPS,
  DEMO_REPO,
  isValidGitHubUrl,
  runScan,
} from "@/lib/scan";
import { useAppSession } from "@/components/app/app-session";
import { WorkspaceSection } from "@/components/app/locked-tab";
import { LoadingProgress } from "@/components/app/ui/loading-progress";
import { ErrorState, classifyScanError } from "@/components/app/ui/error-state";
import { ScanEmptyIllustration } from "@/components/app/ui/scan-empty-illustration";
import { FeedbackBanner, useFeedbackToast } from "@/components/app/ui/feedback-banner";
import { ProjectRootSelectionPanel } from "@/components/app/scan/project-root-selection-panel";
import { FINDINGS_STEPS } from "@/lib/findings/client";
import { canOpenResults } from "@/lib/workflow/results-readiness";

const LOADING_PHASES: ScanPhase[] = [
  "validating",
  "resolving",
  "fetching",
  "unpacking",
  "inventorying",
  "detecting",
  "detecting_roots",
  "detecting_protected",
  "persisting",
  "pending",
];

function phaseIndex(phase: ScanPhase | "idle"): number {
  if (phase === "idle" || phase === "failed" || phase === "pending") return -1;
  const idx = SCAN_STEPS.findIndex((s) => s.phase === phase);
  return idx >= 0 ? idx : SCAN_STEPS.length - 2;
}

export function ScanTab() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const {
    session,
    findings,
    setScanComplete,
    setScanPhase,
    setSelectedProjectRoot,
    resetSession,
    findingsAnalysisPhase,
    findingsAnalysisProgress,
    findingsAnalysisError,
    retryFindingsAnalysis,
  } = useAppSession();
  const { show, Toast } = useFeedbackToast();
  // Blank form until the user pastes/types a URL or starts a demo — do not hydrate from prior session.
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [phase, setPhase] = useState<ScanPhase | "idle">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanPayload | null>(null);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const demoAutoStarted = useRef(false);

  const isLoading = LOADING_PHASES.includes(phase as ScanPhase);
  const [planApprovedForActiveScan, setPlanApprovedForActiveScan] = useState(false);

  const startScan = useCallback(
    async (url: string, isDemo = false) => {
      setError(null);
      setResult(null);
      setIsDemoMode(isDemo);

      const target = isDemo ? DEMO_REPO : url.trim();

      if (!isValidGitHubUrl(target)) {
        setPhase("failed");
        setError(
          "Enter a valid public GitHub repository URL (e.g. https://github.com/owner/repo)."
        );
        return;
      }

      setRepoUrl(target);
      if (!isDemo && branch.trim()) {
        /* keep branch as entered */
      }
      setScanPhase("running");
      show("info", isDemo ? "Loading demo repository…" : "Repository scan started");

      try {
        const data = await runScan(
          target,
          isDemo ? undefined : branch.trim() || undefined,
          setPhase
        );
        setResult(data);
        setBranch(data.repo.branch || branch.trim() || "");
        setScanComplete(target, data.repo.branch || branch.trim(), data);
        show("success", "Repository connected — analysing findings…");
      } catch (err) {
        setPhase("failed");
        setScanPhase("failed");
        const msg = err instanceof Error ? err.message : "Scan failed unexpectedly.";
        setError(msg);
        show("error", classifyScanError(msg).title);
      }
    },
    [branch, router, setScanComplete, setScanPhase, show]
  );

  // Real, server-verified — used only to decide whether "Analyze another
  // repository" needs a confirmation before clearing an approved plan.
  useEffect(() => {
    const scanId = findings?.scanId ?? session.scanRecordId;
    const pinnedCommit = session.scanResult?.repo?.commitSha;
    if (!scanId || !pinnedCommit) {
      setPlanApprovedForActiveScan(false);
      return;
    }
    let cancelled = false;
    void fetch(
      `/api/user-directed/cleanup-plan-status?scanId=${encodeURIComponent(scanId)}&pinnedCommit=${encodeURIComponent(pinnedCommit)}`
    )
      .then((res) => res.json())
      .then((data: { ok?: boolean; approved?: boolean; current?: boolean }) => {
        if (!cancelled) setPlanApprovedForActiveScan(Boolean(data.ok && data.approved && data.current));
      })
      .catch(() => {
        if (!cancelled) setPlanApprovedForActiveScan(false);
      });
    return () => {
      cancelled = true;
    };
  }, [findings?.scanId, session.scanRecordId, session.scanResult?.repo?.commitSha]);

  useEffect(() => {
    const demo = searchParams.get("demo");
    if (demo === "1" || demo === "true") {
      setIsDemoMode(true);
      setRepoUrl(DEMO_REPO);
      if (!demoAutoStarted.current) {
        demoAutoStarted.current = true;
        void startScan(DEMO_REPO, true);
      }
    }
  }, [searchParams, startScan]);

  const findingsAutoNavigated = useRef(false);
  useEffect(() => {
    if (findingsAutoNavigated.current || !result) return;
    // One authoritative pipeline: once findings analysis reaches a terminal
    // state (ready with a real payload, or a genuine failure), automatically
    // advance to Review Findings — no separate "Run Findings" click.
    if (findings || findingsAnalysisPhase === "failed") {
      findingsAutoNavigated.current = true;
      router.push(isDemoMode ? "/app?tab=findings&demo=true" : "/app?tab=findings");
    }
  }, [findings, findingsAnalysisPhase, result, router, isDemoMode]);

  // Only show results from a scan started on this page visit — never from silent session restore.
  const displayResult = result;
  const currentStep = phaseIndex(phase as ScanPhase);
  const showIdle = !isLoading && phase !== "failed" && !result;
  const isAnalysingFindings =
    Boolean(result) &&
    !findings &&
    findingsAnalysisPhase !== "idle" &&
    findingsAnalysisPhase !== "failed";
  const showSuccess = phase === "complete" && Boolean(result);
  const resultsReady = canOpenResults({
    scan: displayResult ? { phase: phase as ScanPhase | "idle", repo: displayResult.repo } : null,
    findings,
    findingsAnalysisPhase,
    findingsAnalysisError,
    activeRepository: session.scanResult?.repo ? { commitSha: session.scanResult.repo.commitSha } : null,
  });

  // Exact contract: analysis is one stage (URL entry through result
  // persistence) — repository resolution alone is never "done", and no
  // action may claim the analysis finished before findings are genuinely
  // completed, validated, and persisted for the active commit.
  const analysisCompleted = resultsReady;
  const analysisFailed = Boolean(result) && Boolean(findingsAnalysisError);
  const analysisRunning =
    isLoading || (Boolean(result) && !resultsReady && !analysisFailed);
  const showOpenResults = analysisCompleted;
  const showAnalyzeAnotherRepository = analysisCompleted || analysisFailed;
  const showRunningMessage = analysisRunning;
  const previousScanLabel =
    !result &&
    !isLoading &&
    session.scanResult?.repo?.owner &&
    session.scanResult?.repo?.name
      ? `${session.scanResult.repo.owner}/${session.scanResult.repo.name}`
      : null;

  const pasteUrl = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setRepoUrl(text.trim());
    } catch {
      /* clipboard unavailable */
    }
  };

  const startFresh = () => {
    if (
      planApprovedForActiveScan &&
      !window.confirm(
        "This repository has an approved cleanup plan. Starting a new analysis clears that plan from this session (the historical record is preserved). Continue?"
      )
    ) {
      return;
    }
    setResult(null);
    setPhase("idle");
    setError(null);
    setRepoUrl("");
    setBranch("");
    setIsDemoMode(false);
    setScanPhase("idle");
    resetSession();
    findingsAutoNavigated.current = false;
    // The auto-navigate effect may have already moved the user to
    // ?tab=findings/patch/verify — always return to the blank scan form,
    // never leave them stranded on a now-locked stage.
    router.push("/app");
  };

  return (
    <div className="space-y-6">
      {Toast}

      {isDemoMode && (
        <FeedbackBanner
          variant="info"
          message={`Example Repository — ${DEMO_NOTICE}`}
          dismissible={false}
        />
      )}

      <WorkspaceSection
        label="Repository connection"
        title="Connect a public repository"
        description="RepoDiet resolves the exact commit, inventories the repository, and runs findings analysis automatically as one workflow."
      />

      <Panel variant="elevated" padding="lg">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void startScan(repoUrl);
          }}
          className="space-y-4"
        >
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <div className="space-y-2">
              <Label htmlFor="repo-url" className="flex items-center gap-2">
                <Github className="h-4 w-4 text-muted-foreground" aria-hidden />
                Repository URL
              </Label>
              <div className="flex gap-2">
                <Input
                  id="repo-url"
                  placeholder="https://github.com/owner/repository"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  disabled={analysisRunning}
                  aria-invalid={phase === "failed" && !!error}
                  className="font-mono text-sm"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={pasteUrl}
                  disabled={analysisRunning}
                  className="shrink-0"
                >
                  Paste
                </Button>
              </div>
            </div>
            <div className="space-y-2 sm:w-48">
              <Label htmlFor="branch">Branch</Label>
              <Input
                id="branch"
                placeholder="Auto-detect default branch"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                disabled={analysisRunning}
              />
              <p className="text-[10px] text-muted-foreground">
                Leave empty and RepoDiet will detect the repository&apos;s default branch.
              </p>
            </div>
          </div>

          {analysisRunning && (
            <p className="text-xs text-muted-foreground">
              An analysis is already running for this repository — submitting a new URL is
              disabled until it finishes, so the active job is never accidentally replaced.
            </p>
          )}

          <div className="flex flex-wrap gap-3 pt-1">
            <Button type="submit" disabled={analysisRunning || !repoUrl.trim()} size="lg">
              {isLoading ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden />
                  Analyzing…
                </>
              ) : (
                "Analyze repository"
              )}
            </Button>
            {isDemoMode ? (
              <Button
                type="button"
                variant="secondary"
                size="lg"
                onClick={startFresh}
                disabled={analysisRunning}
              >
                Exit Example / Analyze My Repository
              </Button>
            ) : null}
          </div>
        </form>
      </Panel>

      {phase === "failed" && error && (
        <ErrorState
          title={classifyScanError(error).title}
          message={classifyScanError(error).hint}
          technicalDetail={error}
          actions={[
            { label: "Retry analysis", onClick: () => void startScan(repoUrl) },
            {
              label: "Choose another repository",
              onClick: () => setPhase("idle"),
              variant: "secondary",
            },
            { label: "Try demo", onClick: () => startScan(DEMO_REPO, true), variant: "outline" },
          ]}
        />
      )}

      {isLoading && (
        <LoadingProgress
          title="Scan progress"
          steps={SCAN_STEPS.filter((s) => s.phase !== "complete").map((s) => ({
            id: s.phase,
            label: s.label,
          }))}
          currentIndex={currentStep}
          ariaLive="polite"
        />
      )}

      {showIdle && <ScanEmptyIllustration />}

      {showIdle && previousScanLabel && (
        <FeedbackBanner
          variant="info"
          message={`A previous scan of ${previousScanLabel} is still available under Findings. Paste a repository URL above to start a new scan.`}
          dismissible
        />
      )}

      {showSuccess && displayResult && (
        <div className="space-y-4">
          {displayResult.repositoryModel?.needsProjectRootSelection && (
            <ProjectRootSelectionPanel
              scan={displayResult}
              selectedRoot={
                session.projectRootConfirmed ? session.selectedProjectRoot : undefined
              }
              onSelect={setSelectedProjectRoot}
            />
          )}

          <Panel variant="safe" padding="md">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-signal">
                  {findingsAnalysisError
                    ? "Repository connected — findings analysis failed"
                    : isAnalysingFindings
                      ? "Analysing repository findings"
                      : resultsReady
                        ? "Analysis complete"
                        : "Analysing repository findings"}
                </p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {displayResult.repo.owner}/{displayResult.repo.name} · {displayResult.repo.branch}
                  {displayResult.repo.commitSha ? (
                    <> · <span title="Commit SHA">{displayResult.repo.commitSha.slice(0, 7)}</span></>
                  ) : null}
                </p>
                <ul className="mt-2 grid gap-1 font-mono text-xs text-muted-foreground sm:grid-cols-2">
                  <li>
                    Files discovered: {displayResult.scanCoverage?.filesDiscovered ?? displayResult.summary.totalFiles}
                  </li>
                  <li>
                    Supported files analysed:{" "}
                    {displayResult.scanCoverage?.contract?.supportedSourceFiles ??
                      displayResult.scanCoverage?.filesAnalyzable ??
                      0}
                  </li>
                  <li>Skipped files: {displayResult.scanCoverage?.filesExcluded ?? 0}</li>
                  <li>
                    Findings:{" "}
                    {findings
                      ? findings.summary.totalFindings
                      : isAnalysingFindings
                        ? `${findingsAnalysisProgress?.completedUnits ?? 0} so far…`
                        : findingsAnalysisError
                          ? "analysis failed"
                          : "—"}
                  </li>
                </ul>
                {displayResult.warnings.length > 0 && (
                  <p className="mt-2 text-xs text-amber-400">{displayResult.warnings.join(" · ")}</p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {showOpenResults ? (
                  <Button asChild disabled={!session.projectRootConfirmed}>
                    <Link href="/app?tab=findings">
                      Open Results
                      <ArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                  </Button>
                ) : analysisFailed ? (
                  <Button onClick={retryFindingsAnalysis}>Retry analysis</Button>
                ) : showRunningMessage ? (
                  <p className="text-xs text-muted-foreground">
                    RepoDiet is analyzing your repository. Results will appear when verification is
                    complete.
                  </p>
                ) : null}
                {showAnalyzeAnotherRepository && (
                  <Button variant="secondary" onClick={startFresh}>
                    {analysisFailed ? "Choose another repository" : "Analyze another repository"}
                  </Button>
                )}
              </div>
            </div>
          </Panel>

          {isAnalysingFindings && (
            <LoadingProgress
              title="Findings analysis"
              steps={FINDINGS_STEPS.filter((s) => s.phase !== "ready").map((s) => ({
                id: s.phase,
                label: s.label,
              }))}
              currentIndex={FINDINGS_STEPS.findIndex((s) => s.phase === findingsAnalysisPhase)}
            />
          )}
        </div>
      )}
    </div>
  );
}
