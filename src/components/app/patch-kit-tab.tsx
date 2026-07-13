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
  repodietInstallReturnPath,
  runPatchKitGeneration,
  startGitHubGrantAccess,
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
import { FixPrA2AFlow } from "@/components/app/fix-pr/fix-pr-a2a-flow";
import { fetchRepositoryStatus } from "@/lib/workflow/client";
import type { RepositoryConnectionStatus } from "@/lib/workflow/github-repository-status";

const LOADING: PatchKitPhase[] = ["classifying", "patch", "validating", "bundle"];

function phaseIndex(phase: PatchKitPhase): number {
  if (phase === "idle" || phase === "failed") return -1;
  return PATCH_KIT_STEPS.findIndex((s) => s.phase === phase);
}

export function PatchKitTab() {
  const searchParams = useSearchParams();
  const demoMode =
    searchParams.get("demo") === "true" || searchParams.get("demo") === "1";
  const { session, findings, patchKit, setPatchKit, selectedFindingIds, a2aTask, setA2aTask, scopeReviewed, setScopeReviewed } = useAppSession();
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

  const [githubStatus, setGithubStatus] = useState<RepositoryConnectionStatus | null>(null);
  const [githubGrantLoading, setGithubGrantLoading] = useState(false);
  const [githubGrantError, setGithubGrantError] = useState<string | null>(null);

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

  const canContinueToVerify = gates.verifyUnlocked;

  const connectGitHub = useCallback(async () => {
    if (!repository) return;
    setGithubGrantLoading(true);
    setGithubGrantError(null);
    try {
      await startGitHubGrantAccess({
        repositoryFullName: repository,
        scanId: findings?.scanId,
        returnPath: repodietInstallReturnPath(findings?.scanId),
      });
    } catch (err) {
      setGithubGrantLoading(false);
      setGithubGrantError(
        err instanceof Error ? err.message : "Could not start GitHub connection."
      );
    }
  }, [findings?.scanId, repository]);

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
        title="Fix & PR"
        description="Available after findings are ready. Run the Findings Engine first."
      />
    );
  }

  if (!gates.fixPrUnlocked && !a2aTask) {
    return (
      <div className="space-y-4">
        <LockedTab
          step="03"
          title={gates.fixPrLockTitle}
          description={gates.fixPrLockBody}
        />
        <div className="flex flex-wrap gap-2">
          {!gates.githubConnected ? (
            <Button onClick={() => void connectGitHub()} disabled={githubGrantLoading}>
              {githubGrantLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Redirecting…
                </>
              ) : (
                gates.fixPrPrimaryAction ?? "Connect GitHub"
              )}
            </Button>
          ) : (
            gates.fixPrPrimaryAction && (
              <Button asChild variant="secondary">
                <Link href="/app?tab=findings">{gates.fixPrPrimaryAction}</Link>
              </Button>
            )
          )}
          {gates.fixPrSecondaryAction && (
            <Button asChild variant="secondary">
              <Link href="/app?tab=findings">{gates.fixPrSecondaryAction}</Link>
            </Button>
          )}
        </div>
        {githubGrantError && (
          <p className="text-sm text-destructive">{githubGrantError}</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {Toast}

      <WorkspaceSection
        label="Paid cleanup delivery"
        title="Fix & PR"
        description="Authorize A2A service 32947 to apply selected safe changes, verify them, and open an isolated cleanup pull request."
      />

      {findings && <AnalysisLineageBanner scan={session.scanResult} findings={findings} />}

      <FixPrA2AFlow
        repoUrl={session.repoUrl}
        branch={session.branch || findings.repo.branch}
        findings={findings}
        selectedFindingIds={selectedFindingIds}
        scopeReviewed={scopeReviewed}
        a2aTask={a2aTask}
        onScopeReviewed={() => setScopeReviewed(true)}
        onTaskUpdate={setA2aTask}
      />

      {showDeveloperTools && patchKit && (
        <Panel variant="elevated" padding="md">
          <p className="ds-label mb-2">Developer tools — legacy patch kit</p>
          <p className="mb-3 text-sm text-muted-foreground">
            Free Quick Cleanup artifacts remain available for inspection. Production delivery uses
            the paid A2A path above.
          </p>
          <Button variant="secondary" size="sm" onClick={generate} disabled={isLoading}>
            {isLoading ? "Generating…" : "Generate patch kit (dev)"}
          </Button>
        </Panel>
      )}
    </div>
  );
}
