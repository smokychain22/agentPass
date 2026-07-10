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
import { FeedbackBanner, useFeedbackToast } from "@/components/app/ui/feedback-banner";

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
  const { session, findings, patchKit, setPatchKit, selectedFindingIds } = useAppSession();
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
        setPhase,
        selectedFindingIds
      );
      setPatchKit(result);
      show("success", "Patch bundle generated");
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Patch kit generation failed.";
      const isPayment = raw.toLowerCase().includes("payment");
      const msg = isPayment
        ? "Patch bundle generation requires x402 payment on this deployment."
        : raw;
      setError(msg);
      show("error", isPayment ? "Payment required" : "Patch kit generation failed");
    }
  }, [findings, session, setPatchKit, show, selectedFindingIds]);

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
        description="Select safe-candidate findings, then generate a review-ready patch bundle with a validated unified diff."
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
          title={
            error.toLowerCase().includes("payment")
              ? "Payment required"
              : "Patch kit generation failed"
          }
          message={
            error.toLowerCase().includes("payment")
              ? "Patch bundle generation is a paid step when x402 is enabled. On the public beta deployment this should be free — retry after the latest deploy, or use the demo repository."
              : "Findings are still available. Retry bundle generation."
          }
          technicalDetail={error}
          actions={[{ label: "Retry", onClick: generate }]}
        />
      )}

      {!patchKit && !isLoading && !error && (
        <EmptyState
          icon={Package}
          title="Findings ready — generate your patch bundle"
          description="RepoDiet classifies safe deletes, builds a git-validated unified diff, and packages deliverables into a downloadable ZIP."
          action={{ label: "Generate Patch Bundle", onClick: generate }}
        />
      )}

      {patchKit && (
        <>
          {patchKit.patchValidation && (
            <FeedbackBanner
              variant={patchKit.patchValidation.status === "passed" ? "success" : "warning"}
              message={
                patchKit.patchValidation.status === "passed"
                  ? `Patch validated with git apply --check (${patchKit.summary.safeDeleteCandidates} file deletions).`
                  : `Patch validation: ${patchKit.patchValidation.status}${patchKit.patchValidation.error ? ` — ${patchKit.patchValidation.error}` : ""}`
              }
              dismissible={false}
            />
          )}
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
