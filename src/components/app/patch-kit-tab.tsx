"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppSession } from "@/components/app/app-session";
import { LockedTab, WorkspaceSection } from "@/components/app/locked-tab";
import {
  PATCH_KIT_STEPS,
  downloadPatchKitZip,
  runPatchKitGeneration,
  type PatchKitPhase,
} from "@/lib/patch-kit/client";
import { PatchKitSummaryCards } from "./patch-kit/summary-cards";
import { SafetyPolicyCard } from "./patch-kit/safety-policy-card";
import { SafeDeleteTable } from "./patch-kit/safe-delete-table";
import { PatchKitWorkspace } from "./patch-kit/patch-kit-workspace";
import { RepoDietOperatorSection } from "./patch-kit/repodiet-operator-section";
import { buildSafeDeleteRows } from "./patch-kit/patch-kit-utils";
import { LoadingProgress } from "@/components/app/ui/loading-progress";
import { ErrorState } from "@/components/app/ui/error-state";
import { EmptyState } from "@/components/app/ui/empty-state";
import { useFeedbackToast } from "@/components/app/ui/feedback-banner";

const LOADING: PatchKitPhase[] = [
  "classifying",
  "patch",
  "package",
  "regression",
  "cursor",
  "bundle",
];

function phaseIndex(phase: PatchKitPhase): number {
  if (phase === "idle" || phase === "failed") return -1;
  return PATCH_KIT_STEPS.findIndex((s) => s.phase === phase);
}

export function PatchKitTab() {
  const searchParams = useSearchParams();
  const demoMode =
    searchParams.get("demo") === "true" || searchParams.get("demo") === "1";
  const { session, findings, patchKit, setPatchKit } = useAppSession();
  const { show, Toast } = useFeedbackToast();
  const [phase, setPhase] = useState<PatchKitPhase>("idle");
  const [error, setError] = useState<string | null>(null);

  const isLoading = LOADING.includes(phase);
  const currentStep = phaseIndex(phase);

  const generate = useCallback(async () => {
    if (!findings || !session.repoUrl) return;
    setError(null);
    show("info", "Generating patch bundle…");

    try {
      const result = await runPatchKitGeneration(
        session.repoUrl,
        session.branch || undefined,
        findings,
        setPhase
      );
      setPatchKit(result);
      show("success", "Patch bundle generated");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Patch kit generation failed.";
      setError(msg);
      show("error", "Patch kit generation failed");
    }
  }, [findings, session, setPatchKit, show]);

  const safeDeleteRows = useMemo(
    () => (findings ? buildSafeDeleteRows(findings) : []),
    [findings]
  );

  const handleCopy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    show("success", `${label} copied`);
  };

  const downloadZip = () => {
    if (!patchKit) return;
    downloadPatchKitZip(patchKit, patchKit.repo.name, patchKit.repo.branch);
    show("success", "Bundle download started");
  };

  if (!findings) {
    return (
      <LockedTab
        step="03"
        title="Patch Kit"
        description="Available after findings are ready. Run the Findings Engine first."
      />
    );
  }

  return (
    <div className="space-y-6">
      {Toast}

      <WorkspaceSection
        label="Review workspace"
        title="Patch Kit"
        description="Generate conservative cleanup artifacts for review — RepoDiet does not apply changes automatically."
        actions={
          <>
            <Button onClick={generate} disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden />
                  Generating…
                </>
              ) : patchKit ? (
                "Regenerate Patch Bundle"
              ) : (
                "Generate Patch Bundle"
              )}
            </Button>
            {patchKit && (
              <Button variant="ghost" asChild>
                <Link href="/app?tab=verify">Continue to Verify</Link>
              </Button>
            )}
          </>
        }
      />

      <p className="font-mono text-xs text-muted-foreground">
        {session.repoUrl}
        {session.branch ? ` · branch: ${session.branch}` : ""}
      </p>

      {isLoading && (
        <LoadingProgress
          title="Bundle pipeline"
          steps={PATCH_KIT_STEPS.filter((s) => s.phase !== "complete").map((s) => ({
            id: s.phase,
            label: s.label,
          }))}
          currentIndex={currentStep}
        />
      )}

      {error && (
        <ErrorState
          title="Patch kit generation failed"
          message="Findings are still available. Retry bundle generation."
          technicalDetail={error}
          actions={[{ label: "Retry", onClick: generate }]}
        />
      )}

      {!patchKit && !isLoading && !error && (
        <EmptyState
          icon={Package}
          title="Findings ready — generate your patch bundle"
          description="RepoDiet will classify safe deletes, build a conservative cleanup patch, and package deliverables into a downloadable ZIP."
          action={{ label: "Generate Patch Bundle", onClick: generate }}
        />
      )}

      {patchKit && (
        <>
          <PatchKitSummaryCards summary={patchKit.summary} />
          <SafetyPolicyCard />
          <PatchKitWorkspace
            artifacts={patchKit.artifacts}
            summary={patchKit.summary}
            onCopy={handleCopy}
            onDownload={downloadZip}
          />
          <SafeDeleteTable rows={safeDeleteRows} />
        </>
      )}

      <RepoDietOperatorSection
        repoUrl={session.repoUrl}
        branch={session.branch || undefined}
        findings={findings}
        patchKit={patchKit}
        demoMode={demoMode}
      />
    </div>
  );
}
