"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { ScanTab } from "@/components/app/scan-tab";
import { FindingsTab } from "@/components/app/findings-tab";
import { PatchKitTab } from "@/components/app/patch-kit-tab";
import { VerifyTab } from "@/components/app/verify-tab";
import { AppSessionProvider, useAppSession } from "@/components/app/app-session";
import { AppTopBar } from "@/components/app/shell/app-top-bar";
import { WorkflowRail, type WorkflowStepId } from "@/components/app/shell/workflow-rail";
import { Container } from "@/components/design-system/container";
import { GridBackground } from "@/components/design-system/grid-background";

function AppWorkspace() {
  const searchParams = useSearchParams();
  const tab = (searchParams.get("tab") || "scan") as WorkflowStepId;
  const isDemo = searchParams.get("demo") === "true" || searchParams.get("demo") === "1";
  const { session, findings, patchKit } = useAppSession();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const scanStatus = session.scanComplete ? "complete" : "idle";

  return (
    <div className="relative flex min-h-screen flex-col bg-background lg:flex-row">
      <GridBackground variant="subtle" className="fixed inset-0 z-0" />

      <AppSidebar
        scanComplete={session.scanComplete}
        findingsReady={Boolean(findings)}
        patchKitReady={Boolean(patchKit)}
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
              scanComplete={session.scanComplete}
              findingsReady={Boolean(findings)}
              patchKitReady={Boolean(patchKit)}
              className="mb-6"
            />

            {tab === "scan" && <ScanTab />}
            {tab === "findings" && <FindingsTab />}
            {tab === "patch" && <PatchKitTab />}
            {tab === "verify" && <VerifyTab />}
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
