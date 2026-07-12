"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { RemediationClassPanel, VerificationGatesPanel } from "./patch-kit/remediation-panel";
import { SafetyPolicyCard } from "./patch-kit/safety-policy-card";
import { SafeDeleteTable } from "./patch-kit/safe-delete-table";
import { PatchKitWorkspace } from "./patch-kit/patch-kit-workspace";
import { RepoDietOperatorSection } from "./patch-kit/repodiet-operator-section";
import { ChangeManifestTable } from "./patch-kit/change-manifest-table";
import { CandidateAuditTable } from "./patch-kit/candidate-audit-table";
import { TransformerResultsTable } from "./patch-kit/transformer-results-table";
import { buildSafeDeleteRows } from "./patch-kit/patch-kit-utils";
import { computeWorkflowGates } from "@/lib/workflow/gates";
import type { PatchKitPayload } from "@/lib/patch-kit/types";
import { isActionableFinding } from "@/lib/findings/actionability-signals";
import { flattenFindings } from "@/lib/findings/client";
import { Panel } from "@/components/design-system/panel";
import { LoadingProgress } from "@/components/app/ui/loading-progress";
import { ErrorState, classifyPatchError } from "@/components/app/ui/error-state";
import { EmptyState } from "@/components/app/ui/empty-state";
import { FeedbackBanner, useFeedbackToast } from "@/components/app/ui/feedback-banner";
import {
  showPatchKitDeveloperTools,
  userFacingPatchFailure,
  userFacingSandboxBanner,
  userFacingSandboxProgress,
} from "@/lib/patch-kit/user-facing-messages";
import { AnalysisLineageBanner } from "@/components/app/analysis-lineage-banner";

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
  const [sandboxProgress, setSandboxProgress] = useState<string | null>(null);
  const showDeveloperTools = showPatchKitDeveloperTools(searchParams);
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

  useEffect(() => {
    const runId = patchKit?.sandboxRunId ?? patchKit?.workerJobId;
    const cleanupRunId = patchKit?.id;
    if (!runId && !cleanupRunId) return;
    const pending =
      patchKit?.patchValidation?.status === "pending_sandbox" ||
      patchKit?.patchValidation?.gitPatchValidation?.status === "pending_sandbox";
    if (!pending) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/sandbox-runs/${runId ?? cleanupRunId}`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          ok: boolean;
          terminal?: boolean;
          patchKit?: PatchKitPayload;
          run?: {
            status: string;
            progress?: string;
            failureCode?: string;
            failureMessage?: string;
            result?: {
              patchValidation?: PatchKitPayload["patchValidation"];
              repositoryVerification?: PatchKitPayload["repositoryVerification"];
            };
          };
        };
        if (!data.ok || cancelled || !patchKit) return;

        if (data.run?.progress) {
          setSandboxProgress(userFacingSandboxProgress(data.run.progress));
        }

        if (data.patchKit) {
          setPatchKit(data.patchKit);
          if (data.patchKit.patchValidation?.status !== "pending_sandbox") {
            setSandboxProgress(null);
          }
          return;
        }

        if (data.terminal && data.run?.result) {
          const result = data.run.result;
          const statusRes = cleanupRunId
            ? await fetch(`/api/patch-kit/status/${cleanupRunId}`)
            : null;
          if (statusRes?.ok && !cancelled) {
            const statusData = (await statusRes.json()) as { patchKit?: PatchKitPayload };
            if (statusData.patchKit) {
              setPatchKit(statusData.patchKit);
              return;
            }
          }

          setPatchKit({
            ...patchKit,
            patchValidation: result.patchValidation ?? patchKit.patchValidation,
            repositoryVerification: result.repositoryVerification ?? patchKit.repositoryVerification,
            summary: {
              ...patchKit.summary,
              patchValidationStatus: result.patchValidation?.status ?? patchKit.summary.patchValidationStatus,
              verifiedChanges:
                result.repositoryVerification?.status === "verified"
                  ? patchKit.summary.generatedChanges
                  : patchKit.summary.verifiedChanges,
              verifiedFileOperations:
                result.repositoryVerification?.status === "verified"
                  ? patchKit.summary.generatedChanges
                  : patchKit.summary.verifiedFileOperations,
              gitValidatedOperations:
                result.patchValidation?.status === "passed"
                  ? patchKit.summary.generatedChanges
                  : patchKit.summary.gitValidatedOperations,
              validatedChanges:
                result.patchValidation?.status === "passed"
                  ? patchKit.summary.generatedChanges
                  : patchKit.summary.validatedChanges,
            },
          });
        }
      } catch {
        /* polling is best-effort */
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [
    patchKit?.id,
    patchKit?.sandboxRunId,
    patchKit?.workerJobId,
    patchKit?.patchValidation?.status,
    patchKit,
    setPatchKit,
  ]);

  const safeDeleteRows = useMemo(
    () => (findings ? buildSafeDeleteRows(findings) : []),
    [findings]
  );

  const verificationIssue = useMemo(() => {
    if (!patchKit?.repositoryVerification) return null;
    const status = patchKit.repositoryVerification.status;
    if (status !== "failed" && status !== "blocked") return null;
    return patchKit.repositoryVerification.error ?? null;
  }, [patchKit]);

  const fixPrDescription = useMemo(() => {
    if (supportedCount === 0) {
      return "No auto-fixable findings in this scan. Duplicates and orphans still need review — report-only PR available.";
    }
    if (
      !patchKit?.repositoryIsPublic &&
      (patchKit?.patchValidation?.gitPatchValidation?.failureCode === "GITHUB_REPOSITORY_NOT_GRANTED" ||
        patchKit?.patchValidation?.userMessage?.includes("GITHUB_REPOSITORY_NOT_GRANTED") ||
        patchKit?.patchValidation?.error?.includes("GITHUB_REPOSITORY_NOT_GRANTED"))
    ) {
      const detail =
        patchKit.patchValidation.userMessage ??
        patchKit.patchValidation.error ??
        "RepoDiet needs GitHub App write access before opening a cleanup pull request.";
      return detail.replace(/^GITHUB_REPOSITORY_NOT_GRANTED:\s*/, "");
    }
    if (patchKit?.repositoryIsPublic && patchKit?.patchValidation?.status === "pending_sandbox") {
      return "Validating cleanup changes on this public repository.";
    }
    if (patchKit?.patchValidation?.status === "pending_sandbox") {
      return "Validating cleanup changes in an isolated environment.";
    }
    if (
      patchKit?.patchValidation?.gitPatchValidation?.failureCode === "WORKER_UNAVAILABLE" ||
      patchKit?.patchValidation?.userMessage?.includes("Docker worker")
    ) {
      return "This cleanup run used a deprecated Docker worker path. Regenerate Quick Cleanup after the latest deployment to run verification in Vercel Sandbox.";
    }
    if (verificationIssue) {
      return verificationIssue;
    }
    if (patchKit?.patchValidation?.status !== "passed" && patchKit?.patchValidation?.userMessage) {
      return patchKit.patchValidation.userMessage;
    }
    if (patchKit?.summary.blockerSummary && !patchKit.summary.blockerSummary.startsWith("Repository verification failed")) {
      return patchKit.summary.blockerSummary;
    }
    if (patchKit?.summary.eligibleFindings) {
      return `${patchKit.summary.eligibleFindings} finding(s) ready for automatic fixes. RepoDiet edits source files, deletes safe dead code, removes packages — then opens a cleanup PR.`;
    }
    return `${supportedCount} finding(s) eligible for automatic cleanup.`;
  }, [supportedCount, patchKit, verificationIssue]);

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
        description={fixPrDescription}
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

      {findings && <AnalysisLineageBanner scan={session.scanResult} findings={findings} />}

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
          {verificationIssue && (
            <FeedbackBanner variant="warning" message={verificationIssue} dismissible={false} />
          )}
          {(patchKit.patchValidation?.gitPatchValidation?.failureCode === "WORKER_UNAVAILABLE" ||
            patchKit.patchValidation?.userMessage?.includes("Docker worker")) && (
            <FeedbackBanner
              variant="warning"
              message="This run targeted a deprecated external Docker worker. Click Regenerate Quick Cleanup to queue verification in Vercel Sandbox."
              dismissible={false}
            />
          )}
          {patchKit.patchValidation?.status === "pending_sandbox" && (patchKit.sandboxRunId ?? patchKit.workerJobId) && (
            <FeedbackBanner
              variant="info"
              message={
                userFacingSandboxBanner(patchKit, sandboxProgress) ??
                "Validating cleanup changes in an isolated environment."
              }
              dismissible={false}
            />
          )}
          {(patchKit.patchValidation?.gitPatchValidation?.failureCode === "GITHUB_REPOSITORY_NOT_GRANTED" ||
            patchKit.patchValidation?.userMessage?.includes("GITHUB_REPOSITORY_NOT_GRANTED")) &&
            !patchKit.repositoryIsPublic && (
            <FeedbackBanner
              variant="warning"
              message={
                (patchKit.patchValidation.userMessage ?? patchKit.patchValidation.error ?? "")
                  .replace(/^GITHUB_REPOSITORY_NOT_GRANTED:\s*/, "") ||
                "Grant GitHub App write access in RepoDiet Operator before opening a cleanup pull request."
              }
              dismissible={false}
            />
          )}
          {patchKit.patchValidation?.status === "blocked" &&
            patchKit.patchValidation.gitPatchValidation?.failureCode !== "GITHUB_REPOSITORY_NOT_GRANTED" &&
            patchKit.patchValidation.gitPatchValidation?.failureCode !== "SANDBOX_UNAVAILABLE" &&
            !verificationIssue && (
            <FeedbackBanner
              variant="warning"
              message={
                patchKit.patchValidation.error ??
                "Content integrity passed but git apply --check is blocked because Git CLI is unavailable in this runtime."
              }
              dismissible={false}
            />
          )}
          {patchKit.patchValidation && patchKit.patchValidation.status === "failed" && !verificationIssue && (
            <FeedbackBanner
              variant="warning"
              message={userFacingPatchFailure(patchKit)}
              dismissible={false}
            />
          )}
          {patchKit.patchValidation?.status === "passed" && (
            <FeedbackBanner
              variant="success"
              message={
                patchKit.summary.verifiedChanges && patchKit.summary.verifiedChanges > 0
                  ? `${patchKit.summary.verifiedFileOperations ?? patchKit.summary.verifiedChanges} verified file operation(s) — click Create Cleanup PR below to apply edits on a review branch. Main is not modified until you merge.`
                  : `${patchKit.summary.generatedFileOperations ?? patchKit.summary.generatedChanges} generated file operation(s); ${patchKit.summary.validatedFileOperations ?? patchKit.summary.validatedChanges ?? 0} patch-validated. Repository verification is required before Create Cleanup PR.`
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
            !verificationIssue &&
            patchKit.patchValidation?.status === "passed" &&
            (patchKit.summary.generatedChanges ?? 0) > 0 &&
            (patchKit.summary.eligibleFindings ?? patchKit.summary.transformerCompatible ?? 0) > 0 &&
            !patchKit.summary.blockerSummary?.includes("repository verification blocked") && (
              <FeedbackBanner
                variant="warning"
                message={
                  patchKit.summary.blockerSummary ??
                  `${patchKit.summary.eligibleFindings ?? patchKit.summary.transformerCompatible} eligible findings; ${patchKit.summary.executedFindings ?? patchKit.summary.attemptedTransformations ?? 0} executed; ${patchKit.summary.generatedFileOperations ?? patchKit.summary.generatedChanges} generated file operations; 0 verified file operations.`
                }
                dismissible={false}
              />
            )}
          {patchKit.patchValidation?.attempt && showDeveloperTools && (
            <Panel variant="elevated" padding="md" className="border-border/60">
              <p className="ds-label mb-2">Developer tools — patch validation</p>
              <pre className="max-h-64 overflow-auto rounded-md bg-muted/40 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
                {JSON.stringify(
                  {
                    contentIntegrity: patchKit.patchValidation.contentIntegrityValidation,
                    gitPatchValidation: patchKit.patchValidation.gitPatchValidation,
                    command: patchKit.patchValidation.attempt.command,
                    exitCode: patchKit.patchValidation.attempt.exitCode,
                    baseCommitSha: patchKit.patchValidation.baseCommitSha,
                    patchHash: patchKit.patchValidation.patchHash,
                    patchGenerationMethod: patchKit.patchValidation.patchGenerationMethod,
                    gitCliAvailable: patchKit.patchValidation.gitCliAvailable,
                    failingPath: patchKit.patchValidation.failingPath,
                    stderr: patchKit.patchValidation.gitStderr ?? patchKit.patchValidation.attempt.stderr,
                    stdout: patchKit.patchValidation.attempt.stdout,
                    durationMs: patchKit.patchValidation.attempt.durationMs,
                  },
                  null,
                  2
                )}
              </pre>
            </Panel>
          )}
          {showDeveloperTools &&
            patchKit.repositoryVerification?.installAttempts &&
            patchKit.repositoryVerification.installAttempts.length > 0 && (
              <Panel variant="elevated" padding="md" className="border-border/60">
                <p className="ds-label mb-2">Developer tools — dependency install</p>
                <pre className="max-h-64 overflow-auto rounded-md bg-muted/40 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
                  {JSON.stringify(patchKit.repositoryVerification.installAttempts, null, 2)}
                </pre>
              </Panel>
            )}
          {patchKit.summary.proofLadder && (
            <ProofLadderPanel
              ladder={
                patchKit.cleanupRunSummary
                  ? {
                      detected: patchKit.cleanupRunSummary.detected,
                      eligible: patchKit.cleanupRunSummary.eligible,
                      executed: patchKit.cleanupRunSummary.executed,
                      attempted: patchKit.cleanupRunSummary.executed,
                      generated: patchKit.cleanupRunSummary.generated,
                      validated: patchKit.cleanupRunSummary.validated,
                      contentValidated: patchKit.cleanupRunSummary.contentValidatedOperations,
                      gitValidated: patchKit.cleanupRunSummary.gitValidatedOperations,
                      verified: patchKit.cleanupRunSummary.verified,
                      delivered: patchKit.cleanupRunSummary.delivered,
                      noop: patchKit.cleanupRunSummary.noOp,
                      failed: patchKit.cleanupRunSummary.failed,
                      notAttempted: patchKit.cleanupRunSummary.notAttempted,
                      rejectedForSafety:
                        patchKit.cleanupRunSummary.reviewRequired +
                        patchKit.cleanupRunSummary.protected,
                    }
                  : patchKit.summary.proofLadder
              }
            />
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <RemediationClassPanel patchKit={patchKit} />
            <VerificationGatesPanel patchKit={patchKit} />
          </div>
          <PatchKitSummaryCards summary={patchKit.summary} />
          {patchKit.candidateAudits && patchKit.candidateAudits.length > 0 && (
            <CandidateAuditTable
              audits={patchKit.candidateAudits}
              repositoryVerified={patchKit.repositoryVerification?.status === "verified"}
            />
          )}
          {patchKit.transformerResults && patchKit.transformerResults.length > 0 && (
            <TransformerResultsTable results={patchKit.transformerResults} />
          )}
          {patchKit.changeManifest && patchKit.changeManifest.length > 0 && (
            <ChangeManifestTable
              entries={patchKit.changeManifest}
              validatedChanges={patchKit.summary.validatedChanges ?? 0}
            />
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
        requireVerificationForCleanupPr={true}
        verificationStatus={patchKit?.repositoryVerification?.status ?? null}
      />
    </div>
  );
}
