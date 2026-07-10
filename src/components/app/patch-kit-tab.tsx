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
import { RateLimitHttpError } from "@/lib/jobs/client";
import type { RateLimitSnapshot } from "@/lib/security/rate-limit";
import { useRateLimitCooldown } from "@/hooks/use-rate-limit-cooldown";
import { PatchKitSummaryCards } from "./patch-kit/summary-cards";
import { ProofLadderPanel } from "./patch-kit/proof-ladder-panel";
import { SafetyPolicyCard } from "./patch-kit/safety-policy-card";
import { SafeDeleteTable } from "./patch-kit/safe-delete-table";
import { PatchKitWorkspace } from "./patch-kit/patch-kit-workspace";
import { RepoDietOperatorSection } from "./patch-kit/repodiet-operator-section";
import { ChangeManifestTable } from "./patch-kit/change-manifest-table";
import { CandidateAuditTable } from "./patch-kit/candidate-audit-table";
import { TransformerResultsTable } from "./patch-kit/transformer-results-table";
import { buildSafeDeleteRows } from "./patch-kit/patch-kit-utils";
import { computeWorkflowGates } from "@/lib/workflow/gates";
import { isActionableFinding } from "@/lib/findings/actionability-signals";
import { flattenFindings } from "@/lib/findings/client";
import { LoadingProgress } from "@/components/app/ui/loading-progress";
import { ErrorState, classifyPatchError } from "@/components/app/ui/error-state";
import { EmptyState } from "@/components/app/ui/empty-state";
import { FeedbackBanner, useFeedbackToast } from "@/components/app/ui/feedback-banner";

const LOADING: PatchKitPhase[] = ["classifying", "patch", "validating", "bundle"];

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
  const [rateLimit, setRateLimit] = useState<RateLimitSnapshot | null>(null);
  const cooldown = useRateLimitCooldown(rateLimit?.resetAt, rateLimit?.retryAfterSeconds);

  const isLoading = LOADING.includes(phase);
  const currentStep = phaseIndex(phase);
  const isRateLimited = rateLimit !== null && !cooldown.canRetry;
  const patchError = error ? classifyPatchError(error) : null;

  const generate = useCallback(async () => {
    if (!findings || !session.repoUrl || isRateLimited) return;
    setError(null);
    setRateLimit(null);
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
      if (err instanceof RateLimitHttpError) {
        setRateLimit(err.rateLimit);
        setError(err.message);
        show("error", "Quick Cleanup limit reached");
        return;
      }
      const raw = err instanceof Error ? err.message : "Patch kit generation failed.";
      const classified = classifyPatchError(raw);
      setError(raw);
      show("error", classified.title);
    }
  }, [findings, session, setPatchKit, show, selectedFindingIds, isRateLimited]);

  const supportedCount = useMemo(() => {
    if (!findings) return 0;
    return (
      findings.summary.transformerCompatible ??
      flattenFindings(findings).filter(isActionableFinding).length
    );
  }, [findings]);

  const gates = useMemo(
    () =>
      computeWorkflowGates({
        scanComplete: session.scanComplete,
        projectRootConfirmed: session.projectRootConfirmed,
        findings,
        patchKit,
      }),
    [session.scanComplete, session.projectRootConfirmed, findings, patchKit]
  );

  const canContinueToVerify = gates.verifyUnlocked;

  const handleCopy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    show("success", `${label} copied`);
  };

  const downloadZip = () => {
    if (!patchKit) return;
    downloadPatchKitZip(patchKit, patchKit.repo.name, patchKit.repo.branch);
    show("success", "Bundle download started");
  };

  const safeDeleteRows = useMemo(
    () => (findings ? buildSafeDeleteRows(findings) : []),
    [findings]
  );

  if (!findings) {
    return (
      <LockedTab
        step="03"
        title="Quick Cleanup"
        description="Available after findings are ready. Run the Findings Engine first."
      />
    );
  }

  return (
    <div className="space-y-6">
      {Toast}

      <WorkspaceSection
        label="Cleanup eligibility"
        title="Fix & PR"
        description={
          supportedCount === 0
            ? "No auto-fixable findings in this scan. Duplicates and orphans still need review — report-only PR available."
            : patchKit?.summary.blockerSummary
              ? patchKit.summary.blockerSummary
              : patchKit?.summary.eligibleFindings
                ? `${patchKit.summary.eligibleFindings} finding(s) ready for automatic fixes. RepoDiet edits source files, deletes safe dead code, removes packages — then opens a cleanup PR.`
                : `${supportedCount} finding(s) eligible for automatic cleanup.`
        }
        actions={
          <>
            {supportedCount > 0 && (
              <Button onClick={generate} disabled={isLoading || isRateLimited}>
                {isLoading ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden />
                    Running…
                  </>
                ) : patchKit ? (
                  "Regenerate Quick Cleanup"
                ) : (
                  "Generate Cleanup Changes"
                )}
              </Button>
            )}
            {canContinueToVerify && (
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

      {error && patchError && (
        <ErrorState
          title={patchError.title}
          message={
            rateLimit
              ? `${patchError.hint} Resets in ${cooldown.formatted}${rateLimit.limit > 0 ? ` (${rateLimit.remaining}/${rateLimit.limit} runs left this hour for this scan)` : ""}.`
              : patchError.hint
          }
          technicalDetail={error}
          actions={[
            {
              label: isRateLimited ? `Retry in ${cooldown.formatted}` : "Retry",
              onClick: generate,
              disabled: isRateLimited,
            },
          ]}
        />
      )}

      {supportedCount === 0 && (
        <FeedbackBanner
          variant="info"
          message="RepoDiet found issues for review, but no deterministic cleanup transformation is available for this scan. A report-only PR remains available after artifacts are generated."
          dismissible={false}
        />
      )}

      {!patchKit && !isLoading && !error && supportedCount > 0 && (
        <EmptyState
          icon={Package}
          title="Supported fixes ready"
          description="RepoDiet will generate real repository-specific changes, validate the patch with git apply --check, and package deliverables for review."
          action={{ label: "Generate Cleanup Changes", onClick: generate }}
        />
      )}

      {patchKit && (
        <>
          {patchKit.patchValidation && (
            <FeedbackBanner
              variant={patchKit.patchValidation.status === "passed" ? "success" : "warning"}
              message={
                patchKit.patchValidation.status === "passed"
                  ? `Patch validated with git apply --check (${patchKit.summary.validatedChanges} change(s), ${patchKit.summary.safeDeleteCandidates} file deletion(s)). Click Create Cleanup PR to apply these edits on a review branch — your main branch is not modified until you merge.`
                  : `Patch validation failed${patchKit.patchValidation.error ? ` — ${patchKit.patchValidation.error}` : ""}. ${patchKit.summary.generatedChanges} source edit(s) were generated in an isolated workspace but the combined patch could not be applied safely. Click Regenerate Quick Cleanup to retry.`
              }
              dismissible={false}
            />
          )}
          {patchKit.patchValidation?.status === "passed" &&
            patchKit.summary.generatedChanges > 0 && (
              <FeedbackBanner
                variant="info"
                message="Changes exist only in RepoDiet's isolated workspace until you create a cleanup pull request. No files on GitHub have been modified yet."
                dismissible={false}
              />
            )}
          {patchKit.summary.generatedChanges === 0 && patchKit.summary.validatedChanges === 0 && (
              <FeedbackBanner
                variant="warning"
                message="RepoDiet found issues, but no supported source changes were generated. Review blockers below or try Regenerate after re-scanning."
                dismissible={false}
              />
            )}
          {patchKit.summary.verifiedChanges === 0 &&
            (patchKit.summary.generatedChanges ?? 0) > 0 &&
            (patchKit.summary.eligibleFindings ?? patchKit.summary.transformerCompatible ?? 0) > 0 && (
              <FeedbackBanner
                variant="warning"
                message={
                  patchKit.summary.blockerSummary ??
                  `${patchKit.summary.eligibleFindings ?? patchKit.summary.transformerCompatible} eligible; ${patchKit.summary.attemptedTransformations ?? 0} attempted; ${patchKit.summary.generatedChanges ?? 0} generated; 0 verified changes retained.`
                }
                dismissible={false}
              />
            )}
          {patchKit.summary.proofLadder && (
            <ProofLadderPanel ladder={patchKit.summary.proofLadder} />
          )}
          <PatchKitSummaryCards summary={patchKit.summary} />
          {patchKit.candidateAudits && patchKit.candidateAudits.length > 0 && (
            <CandidateAuditTable audits={patchKit.candidateAudits} />
          )}
          {patchKit.transformerResults && patchKit.transformerResults.length > 0 && (
            <TransformerResultsTable results={patchKit.transformerResults} />
          )}
          {patchKit.changeManifest && patchKit.changeManifest.length > 0 && (
            <ChangeManifestTable entries={patchKit.changeManifest} />
          )}
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
        requireVerificationForCleanupPr
      />
    </div>
  );
}
