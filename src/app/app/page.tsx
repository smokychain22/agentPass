"use client";

import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { Lock } from "lucide-react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { ScanTab } from "@/components/app/scan-tab";
import { CleanupTab } from "@/components/app/cleanup-tab";
import { AppSessionProvider, useAppSession } from "@/components/app/app-session";

const UserDirectedWorkbench = dynamic(
  () =>
    import("@/components/app/user-directed-workbench").then(
      (m) => m.UserDirectedWorkbench
    ),
  {
    ssr: false,
    loading: () => (
      <p className="text-sm text-muted-foreground">Loading cleanup workbench…</p>
    ),
  }
);
import { AppTopBar } from "@/components/app/shell/app-top-bar";
import { WalletProvider } from "@/components/wallet/wallet-provider";
import { WorkflowRail } from "@/components/app/shell/workflow-rail";
import { Container } from "@/components/design-system/container";
import { GridBackground } from "@/components/design-system/grid-background";
import {
  isRepositoryConnected,
  resolveWorkflowStepStates,
  type WorkflowTabId,
} from "@/lib/workflow/step-states";
import { fetchWorkflowA2ATask } from "@/lib/workflow/client";

function AppWorkspace() {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab") || "scan";
  const tab = tabParam as WorkflowTabId | "cleanup";
  const isDemo = searchParams.get("demo") === "true" || searchParams.get("demo") === "1";
  const {
    session,
    findings,
    a2aTask,
    selectedFindingIds,
    scopeReviewed,
    setA2aTask,
    findingsAnalysisPhase,
    findingsAnalysisError,
  } = useAppSession();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const linkedTaskId = searchParams.get("taskId") ?? searchParams.get("task");

  useEffect(() => {
    if (!linkedTaskId || a2aTask?.taskId === linkedTaskId) return;
    void fetchWorkflowA2ATask(linkedTaskId)
      .then(({ task }) => setA2aTask(task))
      .catch(() => undefined);
  }, [a2aTask?.taskId, linkedTaskId, setA2aTask]);

  const repositoryConnected = isRepositoryConnected({
    scanResult: session.scanResult,
    scanComplete: session.scanComplete,
    scanRecordId: session.scanRecordId,
  });

  const scanId = findings?.scanId ?? session.scanRecordId;
  const pinnedCommit = session.scanResult?.repo?.commitSha ?? findings?.repo.commitSha ?? "";
  const repository = session.scanResult?.repo
    ? `${session.scanResult.repo.owner}/${session.scanResult.repo.name}`
    : findings
      ? `${findings.repo.owner}/${findings.repo.name}`
      : "";

  // Authoritative, server-verified plan/GitHub state — fetched fresh here so
  // it is available to every consumer (nav + direct-URL guard) regardless of
  // which tab is active, and re-fetched on refresh rather than cached.
  const [planReadiness, setPlanReadiness] = useState<{ approved: boolean; current: boolean } | null>(
    null
  );
  const [githubWriteCapable, setGithubWriteCapable] = useState(false);

  useEffect(() => {
    if (!scanId) {
      setPlanReadiness(null);
      return;
    }
    let cancelled = false;
    void fetch(
      `/api/user-directed/cleanup-plan-status?scanId=${encodeURIComponent(scanId)}&pinnedCommit=${encodeURIComponent(pinnedCommit)}`
    )
      .then((res) => res.json())
      .then((data: { ok?: boolean; approved?: boolean; current?: boolean }) => {
        if (cancelled) return;
        setPlanReadiness(
          data.ok ? { approved: Boolean(data.approved), current: Boolean(data.current) } : null
        );
      })
      .catch(() => {
        if (!cancelled) setPlanReadiness(null);
      });
    return () => {
      cancelled = true;
    };
  }, [scanId, pinnedCommit]);

  useEffect(() => {
    if (!repository) {
      setGithubWriteCapable(false);
      return;
    }
    let cancelled = false;
    void fetch("/api/github/capability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ repositoryUrl: `https://github.com/${repository}` }),
    })
      .then((res) => res.json())
      .then((data: { ok?: boolean; canCreatePullRequest?: boolean }) => {
        if (!cancelled) setGithubWriteCapable(Boolean(data.ok && data.canCreatePullRequest));
      })
      .catch(() => {
        if (!cancelled) setGithubWriteCapable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repository]);

  // Real findings lifecycle — never collapse into the structure-scan's own
  // idle/running/failed/complete; a repository can resolve while findings
  // analysis is still running, still failing, or already durably persisted.
  const findingsLifecyclePhase: "idle" | "running" | "failed" | "complete" = repositoryConnected
    ? findings
      ? "complete"
      : findingsAnalysisError
        ? "failed"
        : findingsAnalysisPhase !== "idle"
          ? "running"
          : "idle"
    : "idle";

  const workflowSteps = useMemo(
    () =>
      resolveWorkflowStepStates({
        scanResult: session.scanResult,
        scanComplete: session.scanComplete,
        scanRecordId: session.scanRecordId,
        projectRootConfirmed: session.projectRootConfirmed,
        scanPhase: session.scanPhase,
        findings: repositoryConnected ? findings : null,
        findingsPhase: findingsLifecyclePhase,
        selectedFindingIds,
        scopeReviewed,
        a2aTask,
        activeTab: (tab === "cleanup" ? "scan" : tab) as WorkflowTabId,
        planApproved: planReadiness?.approved ?? false,
        planCurrent: planReadiness?.current ?? false,
        githubWriteCapable,
      }),
    [
      session.scanResult,
      session.scanComplete,
      session.scanRecordId,
      session.projectRootConfirmed,
      session.scanPhase,
      repositoryConnected,
      findings,
      findingsLifecyclePhase,
      selectedFindingIds,
      scopeReviewed,
      a2aTask,
      tab,
      planReadiness,
      githubWriteCapable,
    ]
  );

  const stepMapByTab = useMemo(
    () => new Map(workflowSteps.map((s) => [s.tabId, s])),
    [workflowSteps]
  );

  /**
   * Direct-URL guard: a locked stage must never render its real page just
   * because the URL was typed directly — the sidebar/rail already refuse to
   * link to it, but the route itself must independently refuse too.
   */
  function guardedStageOrLock(tabId: WorkflowTabId, page: ReactNode): ReactNode {
    const step = stepMapByTab.get(tabId);
    if (step && step.status === "locked") {
      return (
        <div className="flex flex-col items-center gap-3 rounded-md border border-border/50 bg-card/30 p-8 text-center">
          <Lock className="h-5 w-5 text-muted-foreground" aria-hidden />
          <p className="font-medium">{step.title} is not available yet</p>
          <p className="max-w-md text-sm text-muted-foreground">
            {step.explanation ?? "This stage unlocks once its prerequisites are complete."}
          </p>
        </div>
      );
    }
    return page;
  }

  // Header reflects real repository connection — never a blank-form cosmetic override.
  const scanStatus = repositoryConnected ? "complete" : "idle";
  const headerRepoUrl = repositoryConnected
    ? session.repoUrl ||
      (session.scanResult?.repo
        ? `https://github.com/${session.scanResult.repo.owner}/${session.scanResult.repo.name}`
        : undefined)
    : undefined;
  const headerBranch = repositoryConnected
    ? session.branch || session.scanResult?.repo?.branch || undefined
    : undefined;

  return (
    <div className="relative flex min-h-screen flex-col bg-background lg:flex-row">
      <GridBackground variant="subtle" className="fixed inset-0 z-0" />

      <AppSidebar
        steps={workflowSteps}
        repositoryConnected={repositoryConnected}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <AppTopBar
          repoUrl={headerRepoUrl}
          branch={headerBranch}
          scanStatus={scanStatus}
          isDemo={isDemo}
          onMenuClick={() => setMobileNavOpen(true)}
        />

        <main className="flex-1 py-5 sm:py-6">
          <Container>
            <WorkflowRail steps={workflowSteps} className="mb-6" />

            {tab === "scan" && <ScanTab />}
            {tab === "findings" &&
              guardedStageOrLock("findings", <UserDirectedWorkbench initialStage="review" />)}
            {tab === "patch" &&
              guardedStageOrLock("patch", <UserDirectedWorkbench initialStage="pay" />)}
            {tab === "verify" &&
              guardedStageOrLock("verify", <UserDirectedWorkbench initialStage="delivery" />)}
            {tab === "cleanup" && <CleanupTab />}
          </Container>
        </main>
      </div>
    </div>
  );
}

export default function AppPage() {
  return (
    <WalletProvider>
      <AppSessionProvider>
        <Suspense
          fallback={
            <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
              Loading workspace…
            </div>
          }
        >
          <AppWorkspace />
        </Suspense>
      </AppSessionProvider>
    </WalletProvider>
  );
}
