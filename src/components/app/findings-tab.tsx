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
import { RepositoryMap } from "./findings/repository-map";
import { JsonExportCard } from "./findings/json-export";
import {
  FINDINGS_STEPS,
  buildCleanupPrompt,
  flattenFindings,
  runFindingsAnalysis,
  type FindingsPhase,
} from "@/lib/findings/client";
import { LoadingProgress } from "@/components/app/ui/loading-progress";
import { ErrorState } from "@/components/app/ui/error-state";
import { EmptyState } from "@/components/app/ui/empty-state";
import { FeedbackBanner } from "@/components/app/ui/feedback-banner";
import { useFeedbackToast } from "@/components/app/ui/feedback-banner";
import { DEMO_NOTICE } from "@/lib/demo/constants";
import { FileSearch } from "lucide-react";
import { Panel } from "@/components/design-system/panel";
import { ProjectRootPanel } from "./findings/project-root-panel";
import { computeWorkflowGates } from "@/lib/workflow/gates";
import { findingsAnalyzerWarning } from "@/lib/findings/analyzer-status";
import { isActionableFinding } from "@/lib/findings/actionability-signals";

const LOADING: FindingsPhase[] = [
  "preparing",
  "duplicates",
  "unused",
  "graph",
  "slop",
  "normalizing",
];

function phaseIndex(phase: FindingsPhase): number {
  if (phase === "idle" || phase === "failed") return -1;
  return FINDINGS_STEPS.findIndex((s) => s.phase === phase);
}

export function FindingsTab() {
  const searchParams = useSearchParams();
  const { session, findings, setFindings, selectedFindingIds, toggleFindingSelection } =
    useAppSession();
  const { show, Toast } = useFeedbackToast();
  const [phase, setPhase] = useState<FindingsPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [promptCopied, setPromptCopied] = useState(false);
  const demoAutoStarted = useRef(false);
  const isDemoMode = searchParams.get("demo") === "true" || searchParams.get("demo") === "1";

  const isLoading = LOADING.includes(phase);
  const currentStep = phaseIndex(phase);

  const runFindings = useCallback(async () => {
    if (!session.scanComplete || !session.repoUrl) return;
    setError(null);
    show("info", "Findings analysis started");

    try {
      const result = await runFindingsAnalysis(
        session.repoUrl,
        session.branch || undefined,
        setPhase,
        session.scanRecordId ?? session.scanResult?.id,
        session.selectedProjectRoot
      );
      setFindings(result);
      show("success", "Findings ready — review classification");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Findings analysis failed.";
      setError(msg);
      show("error", "Findings analysis failed");
    }
  }, [session, setFindings, show]);

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
    return (
      <LockedTab
        step="02"
        title="Findings Engine"
        description={
          session.scanComplete
            ? "Select which application RepoDiet should analyze on the Scan tab before running findings."
            : "Available after repository scan. Complete a scan first to unlock findings analysis."
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
        description="RepoDiet maps duplicate code, unused files, dependencies, orphan patterns, and AI-slop signals."
        actions={
          <>
            <Button onClick={runFindings} disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden />
                  Analyzing…
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
      </p>

      {isLoading && (
        <LoadingProgress
          title="Analysis pipeline"
          steps={FINDINGS_STEPS.filter((s) => s.phase !== "complete").map((s) => ({
            id: s.phase,
            label: s.label,
          }))}
          currentIndex={currentStep}
        />
      )}

      {error && (
        <ErrorState
          title="Findings analysis failed"
          message="Review the repository and retry. The scan structure may be incomplete."
          technicalDetail={error}
          actions={[{ label: "Retry", onClick: runFindings }]}
        />
      )}

      {findings && (
        <>
          {(() => {
            const warning = findingsAnalyzerWarning(findings.rawToolReports);
            return warning ? (
              <FeedbackBanner variant="warning" message={warning} dismissible={false} />
            ) : null;
          })()}

          {findings.mode === "demo" && (
            <FeedbackBanner
              variant="info"
              message="DEMO REPOSITORY — findings are from the seeded demo workspace."
              dismissible={false}
            />
          )}

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
          />
          <JsonExportCard payload={findings} />

          <PanelCTA findings={allFindings} supportedCount={supportedCount} />
        </>
      )}

      {!findings && !isLoading && !error && (
        <EmptyState
          icon={FileSearch}
          title="Scan complete — ready for analysis"
          description="Run the Findings Engine to detect duplicates, unused code, orphan patterns, and AI-slop signals."
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
        <p className="ds-label mb-2">Deterministic cleanup available</p>
        <p className="mb-4 text-sm text-muted-foreground">
          RepoDiet found {supportedCount} supported fix
          {supportedCount === 1 ? "" : "es"} with registered transformers. Continue to Quick Cleanup
          to generate real repository-specific changes, validate the patch, and verify integrity.
        </p>
        <Button asChild>
          <Link href="/app?tab=patch">Continue to Quick Cleanup</Link>
        </Button>
      </Panel>
    );
  }

  return (
    <Panel variant="elevated" padding="md">
      <p className="ds-label mb-2">Review findings</p>
      <p className="mb-4 text-sm text-muted-foreground">
        RepoDiet found issues for review, but no deterministic cleanup transformation is available
        for this scan. You can export findings or create a report-only PR after Quick Cleanup
        artifacts are generated.
      </p>
      <Button variant="secondary" asChild>
        <Link href="/app?tab=patch">View Quick Cleanup options</Link>
      </Button>
    </Panel>
  );
}
