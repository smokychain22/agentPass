"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { ScanTab } from "@/components/app/scan-tab";
import { FindingsTab } from "@/components/app/findings-tab";
import { PatchKitTab } from "@/components/app/patch-kit-tab";
import { VerifyTab } from "@/components/app/verify-tab";
import { CleanupTab } from "@/components/app/cleanup-tab";
import { AppSessionProvider, useAppSession } from "@/components/app/app-session";
import { AppTopBar } from "@/components/app/shell/app-top-bar";
import { WorkflowRail, type WorkflowStepId } from "@/components/app/shell/workflow-rail";
import { Container } from "@/components/design-system/container";
import { GridBackground } from "@/components/design-system/grid-background";
import { computeWorkflowGates } from "@/lib/workflow/gates";
import { fetchRepositoryStatus } from "@/lib/workflow/client";
import type { RepositoryConnectionStatus } from "@/lib/workflow/github-repository-status";

function AppWorkspace() {
  const searchParams = useSearchParams();
  const tab = (searchParams.get("tab") || "scan") as WorkflowStepId;
  const isDemo = searchParams.get("demo") === "true" || searchParams.get("demo") === "1";
  const { session, findings, patchKit, a2aTask, selectedFindingIds, scopeReviewed } = useAppSession();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [githubStatus, setGithubStatus] = useState<RepositoryConnectionStatus | null>(null);

  const repository =
    findings?.repo.owner && findings?.repo.name
      ? `${findings.repo.owner}/${findings.repo.name}`
      : session.repoUrl.replace(/^https:\/\/github\.com\//, "");

  useEffect(() => {
    if (!repository) return;
    void fetchRepositoryStatus({
      repository,
      branch: session.branch || findings?.repo.branch,
      commitSha: findings?.repo.commitSha,
    })
      .then(setGithubStatus)
      .catch(() => setGithubStatus(null));
  }, [repository, session.branch, findings?.repo.branch, findings?.repo.commitSha]);

  const gates = useMemo(
    () =>
      computeWorkflowGates({
        scanComplete: session.scanComplete,
        projectRootConfirmed: session.projectRootConfirmed,
        findings,
        patchKit,
        commitSha: findings?.repo.commitSha,
        githubStatus,
        selectedFindingIds,
        scopeReviewed,
        a2aTask: a2aTask ? { id: a2aTask.taskId, status: a2aTask.status } : null,
      }),
    [
      session.scanComplete,
      session.projectRootConfirmed,
      findings,
      patchKit,
      githubStatus,
      selectedFindingIds,
      scopeReviewed,
      a2aTask,
    ]
  );

  const scanStatus = session.scanComplete ? "complete" : "idle";

  return (
    <div className="relative flex min-h-screen flex-col bg-background lg:flex-row">
      <GridBackground variant="subtle" className="fixed inset-0 z-0" />

      <AppSidebar
        scanComplete={gates.scanComplete}
        findingsUnlocked={gates.findingsUnlocked}
        findingsReady={gates.findingsReady}
        fixPrUnlocked={gates.fixPrUnlocked}
        verifyUnlocked={gates.verifyUnlocked}
        fixPrLockBody={gates.fixPrLockBody}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <AppTopBar
          repoUrl={session.repoUrl}
          branch={session.branch}
          scanStatus={scanStatus}
          isDemo={isDemo}
          onMenuClick={() => setMobileNavOpen(true)}
        />

        <main className="flex-1 py-5 sm:py-6">
          <Container>
            <WorkflowRail
              activeStep={tab}
              scanComplete={gates.scanComplete}
              findingsUnlocked={gates.findingsUnlocked}
              findingsReady={gates.findingsReady}
              fixPrUnlocked={gates.fixPrUnlocked}
              fixPrLockBody={gates.fixPrLockBody}
              verifyUnlocked={gates.verifyUnlocked}
              verifyLockBody={
                gates.verifyUnlocked
                  ? undefined
                  : "Verify unlocks after paid cleanup execution starts"
              }
              className="mb-6"
            />

            {tab === "scan" && <ScanTab />}
            {tab === "findings" && <FindingsTab />}
            {tab === "patch" && <PatchKitTab />}
            {tab === "verify" && <VerifyTab />}
            {tab === "cleanup" && <CleanupTab />}
          </Container>
        </main>
      </div>
    </div>
  );
}

export default function AppPage() {
  return (
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
  );
}
