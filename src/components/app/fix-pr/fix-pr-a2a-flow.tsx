"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/design-system/panel";
import { FeedbackBanner } from "@/components/app/ui/feedback-banner";
import { PaymentAuthorizationPanel } from "@/components/wallet/payment-authorization-panel";
import {
  PrePaymentCleanupPreview,
  selectionBlocksPayment,
} from "@/components/app/fix-pr/pre-payment-cleanup-preview";
import { CustomerPathSelector } from "@/components/wallet/customer-path-selector";
import { useWallet } from "@/components/wallet/wallet-provider";
import type { FindingsPayload } from "@/lib/findings/types";
import type { RepositoryConnectionStatus } from "@/lib/workflow/github-repository-status";
import {
  approveWorkflowDelivery,
  createWorkflowA2ATask,
  fetchAuthoritativeRepositoryAccess,
  fetchRepositoryStatus,
  fetchWorkflowA2ATask,
  fundWorkflowTask,
  payWorkflowQuote,
  type WorkflowA2ATask,
  type WorkflowQuote,
} from "@/lib/workflow/client";
import { flattenFindings } from "@/lib/findings/client";
import { isActionableFinding } from "@/lib/findings/actionability-signals";
import {
  PENDING_GITHUB_GRANT_KEY,
  repodietInstallReturnPath,
  startGitHubGrantAccess,
  syncGitHubRepositoryAccess,
} from "@/lib/patch-kit/client";
import { isTrustedTestQuote } from "@/lib/workflow/payment-ui";
import {
  isWorkflowTaskFailure,
  isWorkflowTaskTerminal,
  workflowFailureGuidance,
  workflowTaskStatusLabel,
} from "@/lib/workflow/task-status-ui";
import {
  formatBaselineInvalidBanner,
  parseBaselineInvalidUi,
  type BaselineInvalidUi,
} from "@/lib/workflow/baseline-invalid-ui";
import { isKnownBaselineInvalidCommit } from "@/lib/workflow/known-invalid-commits";
import { exactChargeLabelFromMicro } from "@/lib/pricing/exact-amount";
import { evaluateControlledDeliverySelection } from "@/lib/cleanup/controlled-delivery-scope";
import { GITHUB_STATUS_TIMEOUT_MS, withTimeout } from "@/lib/wallet/with-timeout";
import {
  deliveryFailureRecovery,
  deliveryProgressSteps,
  deliveryUiPhase,
} from "@/lib/workflow/delivery-progress";
import {
  findingFileName,
  plainLanguageTitle,
} from "@/lib/findings/plain-language";
import {
  loadPersistedSession,
  savePersistedSession,
} from "@/lib/session/persist-session";

interface FixPrA2AFlowProps {
  repoUrl: string;
  branch: string;
  findings: FindingsPayload;
  selectedFindingIds: string[];
  scopeReviewed: boolean;
  a2aTask: WorkflowA2ATask | null;
  onScopeReviewed: () => void;
  onTaskUpdate: (task: WorkflowA2ATask | null) => void;
}

export function FixPrA2AFlow({
  repoUrl,
  branch,
  findings,
  selectedFindingIds,
  scopeReviewed,
  a2aTask,
  onScopeReviewed,
  onTaskUpdate,
}: FixPrA2AFlowProps) {
  const router = useRouter();
  const [github, setGithub] = useState<RepositoryConnectionStatus | null>(null);
  const [quote, setQuote] = useState<WorkflowQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [githubGrantLoading, setGithubGrantLoading] = useState(false);
  const [githubVerifying, setGithubVerifying] = useState(false);
  const [githubRecheckLoading, setGithubRecheckLoading] = useState(false);
  const [githubGrantError, setGithubGrantError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [baselineInvalid, setBaselineInvalid] = useState<BaselineInvalidUi | null>(null);
  const {
    setPaymentState,
    customerMode,
    setCustomerMode,
    session: walletSession,
    isOnXLayer,
    state: walletState,
  } = useWallet();
  const cleanedReturnUrl = useRef(false);
  const githubBootstrapped = useRef<string | null>(null);

  const trustedTestPayment = isTrustedTestQuote(quote);

  useEffect(() => {
    if (!a2aTask?.purchaseChannel) return;
    setCustomerMode(a2aTask.purchaseChannel === "okx_marketplace" ? "okx_marketplace" : "direct");
  }, [a2aTask?.purchaseChannel, setCustomerMode]);

  const githubVerified =
    github?.authoritativeState === "repository_verified" && github?.connected === true;

  const repository = `${findings.repo.owner}/${findings.repo.name}`;
  const commitSha = findings.repo.commitSha ?? "";
  const selectedSafe = useMemo(
    () =>
      flattenFindings(findings).filter(
        (f) => selectedFindingIds.includes(f.id) && isActionableFinding(f)
      ),
    [findings, selectedFindingIds]
  );

  const controlledGate = useMemo(
    () => evaluateControlledDeliverySelection(selectedSafe.flatMap((f) => f.files)),
    [selectedSafe]
  );
  const paymentBlocked = selectionBlocksPayment(selectedSafe);
  // Client bundles only see NEXT_PUBLIC_* unless inlined at build time.
  const deploymentEnv =
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_VERCEL_ENV ||
        process.env.NEXT_PUBLIC_DEPLOYMENT_ENV ||
        "unknown"
      : "unknown";
  const isPreviewDeployment = deploymentEnv === "preview";
  const isProductionDeployment = deploymentEnv === "production";
  // Client banner mirrors server dry-run: anything that is not Production is non-live.
  const previewDryRunUi = !isProductionDeployment;
  const [previewSimulationNote, setPreviewSimulationNote] = useState<string | null>(null);

  const readGithubReturnFromUrl = useCallback(() => {
    if (typeof window === "undefined") {
      return { hasReturn: false as const };
    }
    const params = new URLSearchParams(window.location.search);
    const hasReturn =
      params.get("github") === "connected" ||
      params.get("github_connected") === "true" ||
      params.get("github_recovered") === "installation_only" ||
      params.get("github_repo_pending") === "true";
    const rawInstallationId =
      params.get("github_installation_id") ?? params.get("installation_id");
    const installationId = rawInstallationId ? Number(rawInstallationId) : NaN;
    return {
      hasReturn,
      installationId: Number.isFinite(installationId) ? installationId : undefined,
      setupAction:
        params.get("setup_action") === "update" ? ("update" as const) : undefined,
    };
  }, []);

  const cleanGithubReturnUrl = useCallback(() => {
    if (cleanedReturnUrl.current || typeof window === "undefined") return;
    cleanedReturnUrl.current = true;
    const params = new URLSearchParams(window.location.search);
    params.delete("github");
    params.delete("github_connected");
    params.delete("github_recovered");
    params.delete("github_repo_pending");
    params.delete("setup_action");
    params.delete("github_installation_id");
    params.delete("installation_id");
    const qs = params.toString();
    router.replace(qs ? `/app?${qs}` : "/app?tab=fix-pr", { scroll: false });
  }, [router]);

  const refreshGithubAccess = useCallback(
    async (opts?: {
      sync?: boolean;
      trustPending?: boolean;
      installationId?: number;
      setupAction?: "install" | "update";
      silent?: boolean;
    }) => {
      if (!opts?.silent) {
        setGithubVerifying(true);
      }
      try {
        const pendingGrant =
          typeof window !== "undefined" &&
          window.sessionStorage.getItem(PENDING_GITHUB_GRANT_KEY) === repository;
        const shouldSync = opts?.sync ?? pendingGrant;

        if (shouldSync) {
          await withTimeout(
            syncGitHubRepositoryAccess({
              repositoryFullName: repository,
              branch,
              scanId: findings.scanId,
              commitSha,
              installationId: opts?.installationId,
              setupAction: opts?.setupAction,
              trustPendingPropagation: opts?.trustPending ?? shouldSync,
            }),
            GITHUB_STATUS_TIMEOUT_MS,
            "GitHub access sync timed out. Click Recheck GitHub access to try again."
          );
        }

        const authoritative = await withTimeout(
          fetchAuthoritativeRepositoryAccess({
            owner: findings.repo.owner,
            repo: findings.repo.name,
            installationId: opts?.installationId,
          }),
          GITHUB_STATUS_TIMEOUT_MS,
          "GitHub verification timed out. Click Recheck GitHub access to try again."
        );

        const status = await withTimeout(
          fetchRepositoryStatus({
            repository,
            branch,
            commitSha,
            installationId: opts?.installationId,
          }),
          GITHUB_STATUS_TIMEOUT_MS,
          "GitHub status check timed out. Click Recheck GitHub access to try again."
        );

        setGithub({
          ...status,
          authoritativeState: authoritative.authoritativeState as RepositoryConnectionStatus["authoritativeState"],
          connected:
            authoritative.authoritativeState === "repository_verified" &&
            authoritative.installationTokenAvailable,
          installationTokenAvailable: authoritative.installationTokenAvailable,
          installationIdLast4: authoritative.installationIdLast4,
          checkedAt: authoritative.checkedAt,
        });
        setGithubGrantError(null);

        if (
          authoritative.authoritativeState === "repository_verified" &&
          typeof window !== "undefined"
        ) {
          window.sessionStorage.removeItem(PENDING_GITHUB_GRANT_KEY);
        }

        return authoritative;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Could not verify GitHub access.";
        setGithubGrantError(message);
        setGithub((prev) => ({
          connected: false,
          configured: prev?.configured ?? true,
          repository,
          owner: findings.repo.owner,
          canRead: false,
          canCreateBranch: false,
          canCreatePullRequest: false,
          commitSha,
          messages: {
            title: "GitHub check failed",
            body: message,
            primaryAction: "Recheck GitHub access",
          },
        }));
        return null;
      } finally {
        if (!opts?.silent) {
          setGithubVerifying(false);
        }
      }
    },
    [branch, commitSha, findings.repo.name, findings.repo.owner, findings.scanId, repository]
  );

  useEffect(() => {
    if (githubBootstrapped.current === repository) return;
    githubBootstrapped.current = repository;

    const returnParams = readGithubReturnFromUrl();
    const pendingGrant =
      typeof window !== "undefined" &&
      window.sessionStorage.getItem(PENDING_GITHUB_GRANT_KEY) === repository;

    void refreshGithubAccess({
      sync: returnParams.hasReturn || pendingGrant,
      trustPending: returnParams.hasReturn || pendingGrant,
      installationId: returnParams.installationId,
      setupAction: returnParams.setupAction,
    }).then((authoritative) => {
      if (
        returnParams.hasReturn &&
        authoritative?.authoritativeState === "repository_verified"
      ) {
        cleanGithubReturnUrl();
      }
    });
  }, [cleanGithubReturnUrl, readGithubReturnFromUrl, refreshGithubAccess, repository]);

  useEffect(() => {
    if (!a2aTask?.taskId) return;
    void fetchWorkflowA2ATask(a2aTask.taskId)
      .then(({ task, quote: q }) => {
        onTaskUpdate(task);
        if (q) setQuote(q);
      })
      .catch(() => {
        /* best-effort hydrate */
      });
  }, [a2aTask?.taskId, onTaskUpdate]);

  useEffect(() => {
    if (!a2aTask?.taskId) return;
    if (isWorkflowTaskTerminal(a2aTask)) return;

    const poll = async () => {
      try {
        const { task, quote: q } = await fetchWorkflowA2ATask(a2aTask.taskId);
        onTaskUpdate(task);
        if (q) setQuote(q);
      } catch {
        /* polling best-effort */
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), 4000);
    return () => clearInterval(timer);
  }, [a2aTask?.taskId, a2aTask?.status, onTaskUpdate]);

  const startQuote = useCallback(async () => {
    if (customerMode !== "direct" || !commitSha || selectedSafe.length === 0) return;
    setLoading(true);
    setError(null);
    setBaselineInvalid(null);
    try {
      onScopeReviewed();
      const { task, quote: q } = await createWorkflowA2ATask({
        repoUrl,
        branch,
        scanId: findings.scanId,
        commitSha,
        findingIds: selectedSafe.map((f) => f.id),
      });
      onTaskUpdate(task);
      setQuote(q);
      const stored = loadPersistedSession();
      if (stored && q) {
        savePersistedSession({ ...stored, quoteId: q.quoteId, a2aTaskId: task.taskId });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to prepare quote.";
      setError(message);
      const parsed = parseBaselineInvalidUi({
        message,
        commitSha,
        repository: { owner: findings.repo.owner, name: findings.repo.name },
      });
      if (parsed) setBaselineInvalid(parsed);
    } finally {
      setLoading(false);
    }
  }, [branch, commitSha, customerMode, findings.scanId, onScopeReviewed, onTaskUpdate, repoUrl, selectedSafe]);

  const authorizePayment = useCallback(
    async (input: { payer: string; paymentReference: string; paymentSignature?: string }) => {
      if (!quote || !a2aTask?.taskId) return;
      if (paymentBlocked) {
        throw new Error(
          controlledGate.message ||
            "Payment is blocked until the selected cleanup passes the pre-payment preview gate."
        );
      }
      setLoading(true);
      setError(null);
      setPaymentState("payment_pending");
      try {
        await payWorkflowQuote({
          quoteId: quote.quoteId,
          paymentReference: input.paymentReference,
          payer: input.payer,
          paymentSignature: input.paymentSignature,
          amountMicro: quote.amountMicro,
        });
        const funded = await fundWorkflowTask({
          taskId: a2aTask.taskId,
          quoteId: quote.quoteId,
          paymentReference: input.paymentReference,
          payer: input.payer,
          paymentSignature: input.paymentSignature,
        });
        onTaskUpdate(funded);
        setPaymentState("execution_started");
        const refreshed = await fetchWorkflowA2ATask(funded.taskId);
        onTaskUpdate(refreshed.task);
        if (refreshed.quote) setQuote(refreshed.quote);
      } catch (err) {
        setPaymentState("failed");
        setError(err instanceof Error ? err.message : "Payment failed.");
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [
      a2aTask?.taskId,
      controlledGate.message,
      onTaskUpdate,
      paymentBlocked,
      quote,
      setPaymentState,
    ]
  );

  const retryCleanup = useCallback(() => {
    onTaskUpdate(null);
    setQuote(null);
    setError(null);
    setBaselineInvalid(null);
  }, [onTaskUpdate]);

  const approveProposedChanges = useCallback(async () => {
    if (!a2aTask?.taskId || a2aTask.status !== "awaiting_approval") return;
    setLoading(true);
    setError(null);
    try {
      const approved = await approveWorkflowDelivery(a2aTask.taskId);
      onTaskUpdate(approved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not approve the proposed changes.");
    } finally {
      setLoading(false);
    }
  }, [a2aTask?.status, a2aTask?.taskId, onTaskUpdate]);

  const taskBaselineInvalid = useMemo(() => {
    if (!a2aTask?.error) return null;
    return parseBaselineInvalidUi({
      message: a2aTask.error,
      commitSha,
      repository: { owner: findings.repo.owner, name: findings.repo.name },
    });
  }, [a2aTask?.error, commitSha, findings.repo.name, findings.repo.owner]);

  const pinnedBaselineInvalid = useMemo(() => {
    if (!commitSha || !isKnownBaselineInvalidCommit(commitSha)) return null;
    return parseBaselineInvalidUi({
      commitSha,
      repository: { owner: findings.repo.owner, name: findings.repo.name },
    });
  }, [commitSha, findings.repo.name, findings.repo.owner]);

  const showBaselineBlock = baselineInvalid ?? taskBaselineInvalid ?? pinnedBaselineInvalid;
  const quoteExpired =
    Boolean(quote?.expiresAt) && new Date(quote!.expiresAt!).getTime() <= Date.now();
  const hideRetryCleanup = Boolean(showBaselineBlock?.hideRetry);
  const hideQuoteButton = Boolean(showBaselineBlock?.hideQuoteButton);

  const executing =
    Boolean(a2aTask) &&
    !isWorkflowTaskTerminal(a2aTask) &&
    a2aTask!.status !== "awaiting_payment" &&
    a2aTask!.status !== "awaiting_approval";

  const recheckGitHubAccess = useCallback(async () => {
    setGithubRecheckLoading(true);
    setGithubGrantError(null);
    try {
      const returnParams = readGithubReturnFromUrl();
      await refreshGithubAccess({
        sync: true,
        trustPending: true,
        installationId: returnParams.installationId,
        setupAction: returnParams.setupAction,
      });
    } catch (err) {
      setGithubGrantError(
        err instanceof Error ? err.message : "Could not recheck GitHub repository access."
      );
    } finally {
      setGithubRecheckLoading(false);
    }
  }, [readGithubReturnFromUrl, refreshGithubAccess]);

  const connectGitHub = useCallback(async () => {
    setGithubGrantLoading(true);
    setGithubGrantError(null);
    try {
      await startGitHubGrantAccess({
        repositoryFullName: repository,
        scanId: findings.scanId,
        returnPath: repodietInstallReturnPath(findings.scanId),
      });
    } catch (err) {
      setGithubGrantLoading(false);
      setGithubGrantError(
        err instanceof Error ? err.message : "Could not start GitHub connection."
      );
    }
  }, [findings.scanId, repository]);

  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <li>1. Connect repository</li>
        <li>2. Review suggested cleanup</li>
        <li>3. Select files</li>
        <li>4. Review price</li>
        <li>5. Pay and create PR</li>
        <li>6. Review and merge on GitHub</li>
      </ol>
      {!a2aTask && (
        <CustomerPathSelector mode={customerMode} onModeChange={setCustomerMode} />
      )}
      <Panel variant="elevated" padding="md">
        <p className="ds-label mb-3">Repository connection</p>
        {githubVerifying ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Verifying GitHub access…</span>
          </div>
        ) : githubVerified ? (
          <div className="space-y-1 text-sm">
            <p className="text-signal">Repository access verified</p>
            <p className="text-muted-foreground">
              GitHub App installation confirmed with branch and pull-request write access.
            </p>
          </div>
        ) : github?.authoritativeState === "app_not_configured" || github?.configured === false ? (
          <div className="space-y-1 text-sm">
            <p className="font-medium text-foreground">GitHub delivery is temporarily unavailable</p>
            <p className="text-muted-foreground">
              RepoDiet cannot verify repository access or create a pull request right now. No
              quote or payment has been created. Please try again later.
            </p>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <p className="font-medium text-foreground">
              {github?.messages?.title ?? "Connect GitHub to continue"}
            </p>
            <p className="text-muted-foreground">
              {github?.messages?.body ??
                "Authorize RepoDiet on this repository to create an isolated cleanup branch and pull request."}
            </p>
            <Button
              size="sm"
              onClick={() => void connectGitHub()}
              disabled={githubGrantLoading || githubVerifying}
            >
              {githubGrantLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Redirecting…
                </>
              ) : (
                github?.messages?.primaryAction ?? "Connect GitHub"
              )}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void recheckGitHubAccess()}
              disabled={githubRecheckLoading || githubVerifying}
            >
              {githubRecheckLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Rechecking…
                </>
              ) : (
                "Recheck GitHub access"
              )}
            </Button>
            {githubGrantError && (
              <p className="text-sm text-destructive">{githubGrantError}</p>
            )}
          </div>
        )}
      </Panel>

      <Panel variant="elevated" padding="md">
        {(previewDryRunUi || isProductionDeployment) && (
          <div
            className={`mb-4 rounded-md border p-3 text-sm ${
              previewDryRunUi
                ? "border-amber-500/40 bg-amber-500/10 text-amber-50"
                : "border-destructive/40 bg-destructive/10 text-destructive"
            }`}
          >
            <p className="font-medium">
              {previewDryRunUi
                ? "PREVIEW — NO REAL PAYMENT OR REPOSITORY WRITE"
                : "PRODUCTION environment"}
            </p>
            <p className="mt-1 text-xs">
              {previewDryRunUi
                ? "Server-enforced dry-run: real payment authorization, write-token minting, cleanup dispatch, and GitHub mutation are blocked. Use Simulate authorization for UI validation only."
                : "This deployment can authorize real USDT and create real repository branches/PRs after payment. Do not treat it as a dry-run."}
            </p>
          </div>
        )}
        {previewSimulationNote && (
          <FeedbackBanner variant="info" message={previewSimulationNote} className="mb-3" />
        )}

        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Repository</dt>
            <dd className="font-mono">{repository}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Source commit</dt>
            <dd className="font-mono">{commitSha ? `${commitSha.slice(0, 12)}…` : "—"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Selected cleanup</dt>
            <dd>
              {selectedSafe.length === 0 ? (
                <span className="text-destructive">
                  No safe cleanup selected. Go back to Findings and select a file.
                </span>
              ) : (
                <ul className="mt-1 space-y-1">
                  {selectedSafe.map((f) => (
                    <li key={f.id} className="text-sm">
                      <span className="font-medium text-foreground">{plainLanguageTitle(f)}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {findingFileName(f)} · {f.files[0]}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        </dl>

        {selectedSafe.length > 0 && (
          <PrePaymentCleanupPreview
            findings={selectedSafe}
            pinnedCommit={commitSha}
            repository={repository}
          />
        )}

        <div className="mt-4 rounded-md border border-border/50 bg-card/40 p-3 text-sm text-muted-foreground">
          <p className="mb-1 font-medium text-foreground">Delivery includes</p>
          <ul className="list-inside list-disc space-y-1">
            <li>Isolated branch</li>
            <li>Bounded changes to selected scope only</li>
            <li>Verification before pull request</li>
            <li>Signed delivery receipt (ASP 5283)</li>
          </ul>
        </div>

        {quote && (
          <dl className="mt-4 grid gap-2 rounded-md border border-electric/20 bg-electric/5 p-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Price</dt>
              <dd className="font-medium">
                {exactChargeLabelFromMicro(quote.amountMicro, quote.currency || "USDT")}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Network</dt>
              <dd>X Layer · USDT</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Payment type</dt>
              <dd>Direct payment (not escrow)</dd>
            </div>
            {quote.expiresAt && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Quote expires</dt>
                <dd className="text-xs">{new Date(quote.expiresAt).toLocaleString()}</dd>
              </div>
            )}
            <details className="mt-1 text-xs text-muted-foreground">
              <summary className="cursor-pointer text-electric">Advanced payment details</summary>
              <dl className="mt-2 grid gap-1 font-mono">
                <div className="flex justify-between gap-2">
                  <dt>Atomic amount</dt>
                  <dd>{quote.amountMicro}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Recipient</dt>
                  <dd className="truncate">{quote.recipient}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Quote ID</dt>
                  <dd className="truncate">{quote.quoteId}</dd>
                </div>
              </dl>
            </details>
          </dl>
        )}

        {a2aTask && (
          <div className="mt-4 space-y-3 rounded-md border border-border/50 bg-card/40 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium text-foreground">
                {workflowTaskStatusLabel(a2aTask.status)}
              </p>
              <p className="text-xs text-muted-foreground">
                {deliveryUiPhase({
                  githubConnected: githubVerified,
                  walletConnected: Boolean(walletSession?.address),
                  walletOnCorrectNetwork: isOnXLayer,
                  hasQuote: Boolean(quote),
                  task: a2aTask,
                }).replaceAll("_", " ")}
              </p>
            </div>

            {(executing ||
              ["funded", "generating_changes", "validating_patch", "verifying", "creating_pull_request"].includes(
                a2aTask.status
              )) && (
              <ol className="space-y-1.5 rounded-md border border-border/40 bg-background/40 p-3 text-xs">
                {deliveryProgressSteps(a2aTask).map((step) => (
                  <li
                    key={step.id}
                    className={
                      step.done
                        ? "text-signal"
                        : step.active
                          ? "font-medium text-foreground"
                          : "text-muted-foreground"
                    }
                  >
                    {step.done ? "✓ " : step.active ? "→ " : "· "}
                    {step.label}
                    {step.active && executing ? (
                      <Loader2 className="ml-2 inline h-3 w-3 animate-spin" />
                    ) : null}
                  </li>
                ))}
              </ol>
            )}

            {executing && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>
                  RepoDiet is working on your selected files. This can take a few minutes — you can
                  refresh; progress is saved.
                </span>
              </div>
            )}

            {(() => {
              const recovery = deliveryFailureRecovery(a2aTask);
              if (!recovery) return null;
              return (
                <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                  <p className="font-medium text-destructive">What failed</p>
                  <p className="text-xs text-muted-foreground">{recovery.whatFailed}</p>
                  <ul className="list-inside list-disc text-xs text-muted-foreground">
                    <li>Payment confirmed: {recovery.paymentConfirmed ? "Yes" : "No"}</li>
                    <li>
                      Repository files changed on main:{" "}
                      {recovery.repositoryFilesChanged ? "Yes" : "No (only a PR branch if created)"}
                    </li>
                    <li>Branch or PR exists: {recovery.branchOrPrExists ? "Yes" : "No"}</li>
                    <li>Safe to retry without paying again: {recovery.retrySafe ? "Yes" : "No"}</li>
                  </ul>
                  <p className="text-xs text-foreground">{recovery.nextStep}</p>
                </div>
              );
            })()}

            {a2aTask.status === "awaiting_approval" && (
              <div className="space-y-3 rounded-md border border-electric/25 bg-electric/5 p-3">
                <div>
                  <p className="font-medium text-foreground">Review the proposed cleanup before RepoDiet opens the pull request</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    RepoDiet prepared {a2aTask.approval?.changes?.length ?? 0} bounded change
                    {(a2aTask.approval?.changes?.length ?? 0) === 1 ? "" : "s"}. Nothing is merged automatically.
                  </p>
                </div>
                <Button onClick={() => void approveProposedChanges()} disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Approve changes and create pull request"}
                </Button>
              </div>
            )}
            {isWorkflowTaskFailure(a2aTask) && (
              <FeedbackBanner
                variant="error"
                message={
                  taskBaselineInvalid
                    ? formatBaselineInvalidBanner(taskBaselineInvalid)
                    : (a2aTask.error ?? workflowFailureGuidance(a2aTask))
                }
              />
            )}
            {a2aTask.pullRequest?.url && (
              <div className="space-y-4 rounded-md border border-signal/30 bg-signal/5 p-4">
                <div>
                  <p className="text-base font-semibold text-signal">Your cleanup pull request is ready</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Review the changed files and GitHub checks. Merge only when the result matches your expectations.
                  </p>
                </div>
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">Repository</dt>
                    <dd className="font-mono text-xs">{repository}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Pull request</dt>
                    <dd className="font-mono text-xs">#{a2aTask.pullRequest.number ?? "Not available"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Source branch</dt>
                    <dd className="font-mono text-xs">{a2aTask.pullRequest.branch ?? "Not available"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Target branch</dt>
                    <dd className="font-mono text-xs">{findings.repo.branch}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Changed files</dt>
                    <dd>{a2aTask.approval?.changes?.length ?? "Not available"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Verification</dt>
                    <dd>{a2aTask.verification?.status ?? a2aTask.prDelivery?.deliveryState ?? "Not verified"}</dd>
                  </div>
                </dl>
                <div className="flex flex-wrap gap-2">
                  <Button asChild>
                    <a href={a2aTask.pullRequest.url} target="_blank" rel="noreferrer">
                      Review Pull Request
                    </a>
                  </Button>
                  <Button asChild variant="secondary">
                    <Link href="/app?tab=verify">Review &amp; Accept</Link>
                  </Button>
                </div>
              </div>
            )}
            {a2aTask.status === "completed" && a2aTask.receipt && (
              <dl className="mt-2 grid gap-1 rounded-md border border-border/40 bg-background/40 p-2 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Receipt</dt>
                  <dd className="font-mono">
                    {String(
                      (a2aTask.receipt as { receiptId?: string }).receiptId ??
                        (a2aTask.receipt as { id?: string }).id ??
                        "—"
                    )}
                  </dd>
                </div>
                {(a2aTask.receipt as { hash?: string }).hash && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Receipt hash</dt>
                    <dd className="truncate font-mono">
                      {String((a2aTask.receipt as { hash?: string }).hash)}
                    </dd>
                  </div>
                )}
              </dl>
            )}
            {trustedTestPayment && a2aTask.status !== "awaiting_payment" && (
              <p className="text-xs text-muted-foreground">
                Test payment mode: no on-chain USDT transfer is required for the 0.20 USDT personal test price.
              </p>
            )}
          </div>
        )}

        {showBaselineBlock && (
          <div className="mt-3 space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="font-medium text-foreground">{showBaselineBlock.title}</p>
            <dl className="grid gap-1 text-xs">
              <div>
                <dt className="text-muted-foreground">Source commit</dt>
                <dd className="font-mono">{showBaselineBlock.sourceCommit}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Failed check</dt>
                <dd className="font-mono">{showBaselineBlock.failedCheck}</dd>
              </div>
              {showBaselineBlock.errorLocation && (
                <div>
                  <dt className="text-muted-foreground">First actionable error</dt>
                  <dd className="font-mono">{showBaselineBlock.errorLocation}</dd>
                </div>
              )}
              {showBaselineBlock.firstActionableError && (
                <div>
                  <dt className="text-muted-foreground">Diagnostic</dt>
                  <dd>{showBaselineBlock.firstActionableError}</dd>
                </div>
              )}
              <div>
                <dt className="text-muted-foreground">Classification</dt>
                <dd className="font-mono">{showBaselineBlock.classification}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">RepoDiet-selected cleanup caused this</dt>
                <dd>{showBaselineBlock.causedByCleanup ? "Yes" : "No"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Required action</dt>
                <dd>{showBaselineBlock.action}</dd>
              </div>
            </dl>
            {showBaselineBlock.fileUrl && (
              <a
                className="text-xs text-electric underline"
                href={showBaselineBlock.fileUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open failing source on GitHub
              </a>
            )}
            <p className="text-xs text-muted-foreground">{showBaselineBlock.scanGuidance}</p>
          </div>
        )}

        {error && !showBaselineBlock && <FeedbackBanner variant="error" message={error} className="mt-3" />}

        <div className="mt-4 flex flex-wrap gap-2">
          {customerMode === "direct" && (!quote || quoteExpired) && !hideQuoteButton && (
            <Button onClick={startQuote} disabled={loading || !githubVerified || selectedSafe.length === 0}>
              {loading ? (
                <Loader2 className="animate-spin" />
              ) : quoteExpired ? (
                "Generate fresh quote"
              ) : scopeReviewed ? (
                "Refresh quote"
              ) : (
                "Review cleanup scope"
              )}
            </Button>
          )}
          {customerMode === "direct" && quote && !quoteExpired && a2aTask?.status === "awaiting_payment" && !hideQuoteButton && (
            <PaymentAuthorizationPanel
              quote={quote}
              loading={loading}
              authorizationBlocked={paymentBlocked}
              authorizationBlockReason={controlledGate.message}
              previewDryRun={previewDryRunUi}
              onSimulateAuthorization={() => {
                setPreviewSimulationNote(
                  "Preview simulation only — no wallet call, no USDT transfer, no write token, no worker dispatch, no GitHub mutation."
                );
              }}
              onAuthorize={authorizePayment}
            />
          )}
          {isWorkflowTaskFailure(a2aTask) && !hideRetryCleanup && (
            <Button onClick={retryCleanup}>Start a new cleanup attempt</Button>
          )}
          {showBaselineBlock ? (
            <>
              <Button asChild>
                <Link href="/app?tab=scan">Back to Scan</Link>
              </Button>
              {showBaselineBlock.commitUrl && (
                <Button variant="secondary" asChild>
                  <a href={showBaselineBlock.commitUrl} target="_blank" rel="noreferrer">
                    Open repository commit
                  </a>
                </Button>
              )}
            </>
          ) : (
            <Button variant="secondary" asChild>
              <Link href="/app?tab=findings">Back to findings</Link>
            </Button>
          )}
        </div>
      </Panel>
    </div>
  );
}
