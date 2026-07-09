"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { PageHeader, LockedTab } from "@/components/app/locked-tab";
import { ScanTab } from "@/components/app/scan-tab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

function AppContent() {
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") || "scan";

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <AppSidebar />

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-4 py-3 lg:hidden">
          <Link href="/" className="text-sm font-semibold">
            RepoDiet
          </Link>
          <div className="flex gap-2 text-xs">
            <Link href="/docs" className="text-muted-foreground hover:text-foreground">
              Docs
            </Link>
            <Link href="/okx" className="text-muted-foreground hover:text-foreground">
              OKX
            </Link>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
          <PageHeader
            title="Scan Repository"
            subtitle="Paste a public GitHub repository and RepoDiet will inspect the structure, framework, package manager, and file tree."
            badge={
              <Badge variant="signal" className="font-mono text-[10px] uppercase tracking-wider">
                Phase 2 live
              </Badge>
            }
          />

          <Tabs value={tab} className="w-full">
            <TabsList className="inline-flex w-auto max-w-full justify-start">
              <TabsTrigger value="scan" asChild>
                <Link href="/app">Scan</Link>
              </TabsTrigger>
              <TabsTrigger value="findings" asChild>
                <Link href="/app?tab=findings">Findings</Link>
              </TabsTrigger>
              <TabsTrigger value="patch" asChild>
                <Link href="/app?tab=patch">Patch Kit</Link>
              </TabsTrigger>
              <TabsTrigger value="verify" asChild>
                <Link href="/app?tab=verify">Verify</Link>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="scan">
              <ScanTab />
            </TabsContent>

            <TabsContent value="findings">
              <LockedTab
                step="02"
                title="Findings"
                description="Available after scan. Duplicate clusters, dead files, and unused dependencies will appear here in Phase 3."
              />
            </TabsContent>

            <TabsContent value="patch">
              <LockedTab
                step="03"
                title="Patch Kit"
                description="Available after findings. Cleanup patches, regression contracts, and Cursor prompts generate from confirmed findings."
              />
            </TabsContent>

            <TabsContent value="verify">
              <LockedTab
                step="04"
                title="Verify"
                description="Available after patch kit. Run the regression checklist and export your OKX delivery bundle."
              />
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </div>
  );
}

export default function AppPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
          Loading…
        </div>
      }
    >
      <AppContent />
    </Suspense>
  );
}
