"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { ScanTab } from "@/components/app/scan-tab";
import { UserDirectedWorkbench } from "@/components/app/user-directed-workbench";
import { CleanupTab } from "@/components/app/cleanup-tab";
import { AppSessionProvider, useAppSession } from "@/components/app/app-session";
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

  const workflowSteps = useMemo(
    () =>
      resolveWorkflowStepStates({
        scanResult: session.scanResult,
        scanComplete: session.scanComplete,
        scanRecordId: session.scanRecordId,
        projectRootConfirmed: session.projectRootConfirmed,
        scanPhase: session.scanPhase,
        findings: repositoryConnected ? findings : null,
        selectedFindingIds,
        scopeReviewed,
        a2aTask,
        activeTab: (tab === "cleanup" ? "scan" : tab) as WorkflowTabId,
      }),
    [
      session.scanResult,
      session.scanComplete,
      session.scanRecordId,
      session.projectRootConfirmed,
      session.scanPhase,
      repositoryConnected,
      findings,
      selectedFindingIds,
      scopeReviewed,
      a2aTask,
      tab,
    ]
  );

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
            {tab === "findings" && (
              <UserDirectedWorkbench initialTab="suggestions" />
            )}
            {tab === "patch" && <UserDirectedWorkbench initialTab="patch" />}
            {tab === "verify" && <UserDirectedWorkbench initialTab="delivery" />}
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
