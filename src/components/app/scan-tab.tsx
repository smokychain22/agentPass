"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Github, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/design-system/panel";
import { MetricCard } from "@/components/design-system/metric-card";
import { RiskBadge } from "@/components/design-system/risk-badge";
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
import { AnalysisLineageBanner } from "@/components/app/analysis-lineage-banner";
import { ScanCoveragePanel } from "@/components/app/scan/scan-coverage-panel";

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
  const { session, setScanComplete, setScanPhase, setSelectedProjectRoot, resetSession } =
    useAppSession();
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
        show("success", "Scan complete — review findings next");
        if (isDemo) {
          router.push("/app?tab=findings&demo=true");
        }
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

  // Only show results from a scan started on this page visit — never from silent session restore.
  const displayResult = result;
  const currentStep = phaseIndex(phase as ScanPhase);
  const showIdle = !isLoading && phase !== "failed" && !result;
  const showSuccess = phase === "complete" && Boolean(result);
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
    setResult(null);
    setPhase("idle");
    setError(null);
    setRepoUrl("");
    setBranch("");
    setIsDemoMode(false);
    setScanPhase("idle");
    resetSession();
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
        title="Scan a public repository"
        description="RepoDiet downloads your public GitHub repository archive (read-only), pins the branch commit, and maps structure before findings analysis."
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
                  disabled={isLoading}
                  aria-invalid={phase === "failed" && !!error}
                  className="font-mono text-sm"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={pasteUrl}
                  disabled={isLoading}
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
                disabled={isLoading}
              />
              <p className="text-[10px] text-muted-foreground">
                Leave empty and RepoDiet will detect the repository&apos;s default branch.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Scan mode</Label>
            <div className="flex flex-wrap gap-2">
              <Badge variant="cyan">Structure scan</Badge>
              <Badge variant="neutral" className="gap-1.5 opacity-70" title="Full analyzer pass runs on the Findings step">
                Findings analyzers on next step
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              This step indexes the repository. Knip, jscpd, and Madge run on Findings; Quick Cleanup
              applies fixes and opens a cleanup PR.
            </p>
          </div>

          <div className="flex flex-wrap gap-3 pt-1">
            <Button type="submit" disabled={isLoading || !repoUrl.trim()} size="lg">
              {isLoading ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden />
                  Scanning…
                </>
              ) : (
                "Scan Repository"
              )}
            </Button>
            {isDemoMode ? (
              <Button
                type="button"
                variant="secondary"
                size="lg"
                onClick={startFresh}
                disabled={isLoading}
              >
                Exit Example / Analyze My Repository
              </Button>
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="lg"
                onClick={() => void startScan(DEMO_REPO, true)}
                disabled={isLoading}
              >
                Try Demo Repository
              </Button>
            )}
          </div>
        </form>
      </Panel>

      {phase === "failed" && error && (
        <ErrorState
          title={classifyScanError(error).title}
          message={classifyScanError(error).hint}
          technicalDetail={error}
          actions={[
            { label: "Retry scan", onClick: () => void startScan(repoUrl) },
            { label: "Edit repository", onClick: () => setPhase("idle"), variant: "secondary" },
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
          <Panel variant="safe" padding="md">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-signal">Scan complete</p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {displayResult.repo.owner}/{displayResult.repo.name} · {displayResult.repo.branch}
                  {displayResult.repo.commitSha ? (
                    <> · <span title="Commit SHA">{displayResult.repo.commitSha.slice(0, 7)}</span></>
                  ) : null}
                </p>
                {typeof displayResult.summary?.totalFiles === "number" && (
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {displayResult.summary.totalFiles.toLocaleString()} files inventoried
                    {typeof displayResult.summary.totalFolders === "number"
                      ? ` · ${displayResult.summary.totalFolders.toLocaleString()} top-level folders`
                      : ""}
                  </p>
                )}
                {session.scanRecordId && (
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                    Scan ID: {session.scanRecordId}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {session.projectRootConfirmed ? (
                  <Button asChild>
                    <Link href="/app?tab=findings">
                      Run Findings
                      <ArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                  </Button>
                ) : (
                  <Button disabled title="Select an application root below">
                    Run Findings
                  </Button>
                )}
                <Button variant="secondary" onClick={startFresh}>
                  Run Another Scan
                </Button>
              </div>
            </div>
          </Panel>

          <AnalysisLineageBanner scan={displayResult} />

          <ScanCoveragePanel
            scan={displayResult}
            manifest={displayResult.intelligenceManifest}
          />

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Framework" value={displayResult.framework.name} accent="cyan" />
            <MetricCard
              label="Package manager"
              value={displayResult.packageManager.toUpperCase()}
              accent="neutral"
            />
            <MetricCard
              label="Files indexed"
              value={displayResult.summary.totalFiles.toLocaleString()}
              accent="neutral"
            />
            <MetricCard
              label="Supported JS/TS source"
              value={(
                displayResult.scanCoverage?.contract?.supportedSourceFiles ??
                displayResult.scanCoverage?.filesAnalyzable ??
                displayResult.repositoryModel?.analyzableSourceFiles ??
                displayResult.summary.totalFiles
              ).toLocaleString()}
              accent="neutral"
            />
          </div>

          {displayResult.repositoryModel?.needsProjectRootSelection && (
            <ProjectRootSelectionPanel
              scan={displayResult}
              selectedRoot={
                session.projectRootConfirmed ? session.selectedProjectRoot : undefined
              }
              onSelect={setSelectedProjectRoot}
            />
          )}

          {displayResult.repositoryModel && (
            <Panel variant="elevated" padding="md">
              <p className="ds-label mb-3">Project roots</p>
              <p className="mb-3 text-sm text-muted-foreground">
                Primary root:{" "}
                <span className="font-mono text-foreground">
                  {displayResult.repositoryModel.primaryProjectRoot}
                </span>
                {displayResult.repositoryModel.monorepoTool
                  ? ` · ${displayResult.repositoryModel.monorepoTool} monorepo`
                  : ""}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border/40 text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 pr-4">Root</th>
                      <th className="py-2 pr-4">Framework</th>
                      <th className="py-2 pr-4">Role</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayResult.repositoryModel.projects.map((p) => {
                      const project = p as {
                        projectRoot?: string;
                        framework?: string;
                        role?: string;
                      };
                      return (
                        <tr key={String(project.projectRoot)} className="border-b border-border/20">
                          <td className="py-2 pr-4 font-mono text-xs">{project.projectRoot || "."}</td>
                          <td className="py-2 pr-4">{project.framework ?? "unknown"}</td>
                          <td className="py-2 pr-4">{project.role ?? "unknown"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          {displayResult.warnings.length > 0 && (
            <FeedbackBanner
              variant="warning"
              message={displayResult.warnings.join(" · ")}
              dismissible={false}
            />
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <ScanDetailPanel title="Repository summary">
              <dl className="space-y-2 text-sm">
                <DetailRow label="Top-level folders" value={displayResult.summary.totalFolders.toLocaleString()} />
                <DetailRow label="Total size" value={`${displayResult.summary.totalSizeKb.toLocaleString()} KB`} />
                <DetailRow label="Config files" value={String(displayResult.configFiles.length)} />
                <DetailRow
                  label="Protected paths"
                  value={String(displayResult.repositoryModel?.protectedFileCount ?? "—")}
                />
                {displayResult.repo.commitSha && (
                  <DetailRow label="Commit SHA" value={displayResult.repo.commitSha} />
                )}
              </dl>
            </ScanDetailPanel>
            <ScanDetailPanel title="Framework detection">
              <div className="space-y-2">
                <DetailRow label="Framework" value={displayResult.framework.name} />
                <p className="text-xs text-muted-foreground">Detected from deterministic signals:</p>
                <ul className="space-y-1 font-mono text-xs text-muted-foreground">
                  {displayResult.framework.signals.map((s) => (
                    <li key={s}>✓ {s}</li>
                  ))}
                </ul>
              </div>
            </ScanDetailPanel>
          </div>

          <div className="flex flex-wrap gap-2">
            <RiskBadge level="cyan">Structure mapped</RiskBadge>
            <RiskBadge level="safe">No changes during scan</RiskBadge>
          </div>
        </div>
      )}
    </div>
  );
}

function ScanDetailPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Panel variant="elevated" padding="md">
      <p className="ds-label mb-3">{title}</p>
      {children}
    </Panel>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono text-foreground">{value}</dd>
    </div>
  );
}
