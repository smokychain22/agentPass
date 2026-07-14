"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/design-system/panel";
import { FeedbackBanner } from "@/components/app/ui/feedback-banner";
import { PaymentAuthorizationPanel } from "@/components/wallet/payment-authorization-panel";
import { useWallet } from "@/components/wallet/wallet-provider";
import type { FindingsPayload } from "@/lib/findings/types";
import type { RepositoryConnectionStatus } from "@/lib/workflow/github-repository-status";
import {
  approveWorkflowDelivery,
  createWorkflowA2ATask,
  fetchRepositoryStatus,
  fetchWorkflowA2ATask,
  fundWorkflowTask,
  payWorkflowQuote,
  type WorkflowA2ATask,
  type WorkflowQuote,
} from "@/lib/workflow/client";
import { flattenFindings } from "@/lib/findings/client";
import { isActionableFinding } from "@/lib/findings/actionability-signals";
import { repodietInstallReturnPath, startGitHubGrantAccess } from "@/lib/patch-kit/client";
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
  const [github, setGithub] = useState<RepositoryConnectionStatus | null>(null);
  const [quote, setQuote] = useState<WorkflowQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [githubGrantLoading, setGithubGrantLoading] = useState(false);
  const [githubGrantError, setGithubGrantError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [baselineInvalid, setBaselineInvalid] = useState<BaselineInvalidUi | null>(null);
  const { setPaymentState } = useWallet();

  const trustedTestPayment = isTrustedTestQuote(quote);

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

  useEffect(() => {
    void fetchRepositoryStatus({ repository, branch, commitSha })
      .then(setGithub)
      .catch(() => setGithub(null));
  }, [repository, branch, commitSha]);

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
        if (
          task.status === "awaiting_approval" &&
          (task.approval?.changes?.length ?? 0) > 0
        ) {
          const approved = await approveWorkflowDelivery(task.taskId);
          onTaskUpdate(approved);
        }
      } catch {
        /* polling best-effort */
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), 4000);
    return () => clearInterval(timer);
  }, [a2aTask?.taskId, a2aTask?.status, onTaskUpdate]);

  const startQuote = useCallback(async () => {
    if (!commitSha || selectedSafe.length === 0) return;
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
  }, [branch, commitSha, findings.scanId, onScopeReviewed, onTaskUpdate, repoUrl, selectedSafe]);

  const authorizePayment = useCallback(
    async (input: { payer: string; paymentReference: string; paymentSignature?: string }) => {
      if (!quote || !a2aTask?.taskId) return;
      setLoading(true);
      setError(null);
      setPaymentState("payment_pending");
      try {
        await payWorkflowQuote({
          quoteId: quote.quoteId,
          paymentReference: input.paymentReference,
          payer: input.payer,
          paymentSignature: input.paymentSignature,
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
    [a2aTask?.taskId, onTaskUpdate, quote, setPaymentState]
  );

  const retryCleanup = useCallback(() => {
    onTaskUpdate(null);
    setQuote(null);
    setError(null);
    setBaselineInvalid(null);
  }, [onTaskUpdate]);

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
  const hideRetryCleanup = Boolean(showBaselineBlock?.hideRetry);
  const hideQuoteButton = Boolean(showBaselineBlock?.hideQuoteButton);

  const executing =
    Boolean(a2aTask) &&
    !isWorkflowTaskTerminal(a2aTask) &&
    a2aTask!.status !== "awaiting_payment";

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
      <Panel variant="elevated" padding="md">
        <p className="ds-label mb-3">Repository connection</p>
        {githubVerified ? (
          <div className="space-y-1 text-sm">
            <p className="text-signal">Repository access verified</p>
            <p className="text-muted-foreground">
              GitHub App installation confirmed with branch and pull-request write access.
            </p>
          </div>
        ) : github?.authoritativeState === "app_not_configured" || github?.configured === false ? (
          <div className="space-y-1 text-sm">
            <p className="font-medium text-foreground">GitHub App is not configured</p>
            <p className="text-muted-foreground">
              This deployment is missing GitHub App credentials. Set GITHUB_APP_* environment
              variables on Vercel to enable Fix &amp; PR.
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
              disabled={githubGrantLoading}
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
            {githubGrantError && (
              <p className="text-sm text-destructive">{githubGrantError}</p>
            )}
          </div>
        )}
      </Panel>

      <Panel variant="elevated" padding="md">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Repository</dt>
            <dd className="font-mono">{repository}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Source commit</dt>
            <dd className="font-mono">{commitSha ? `${commitSha.slice(0, 8)}…` : "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Selected scope</dt>
            <dd>
              {selectedSafe.length} safe cleanup{selectedSafe.length === 1 ? "" : "s"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Provider</dt>
            <dd>RepoDiet Cleanup Operator · A2A 32947</dd>
          </div>
        </dl>

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
              <dd className="font-mono">{quote.priceLabel}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Network / asset</dt>
              <dd className="font-mono">
                {quote.network} · {quote.currency}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Recipient</dt>
              <dd className="truncate font-mono text-xs">{quote.recipient}</dd>
            </div>
            {quote.expiresAt && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Quote expires</dt>
                <dd className="font-mono text-xs">{new Date(quote.expiresAt).toLocaleString()}</dd>
              </div>
            )}
          </dl>
        )}

        {a2aTask && (
          <div className="mt-4 space-y-3 rounded-md border border-border/50 bg-card/40 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium text-foreground">
                {workflowTaskStatusLabel(a2aTask.status)}
              </p>
              <p className="font-mono text-xs text-muted-foreground">{a2aTask.taskId}</p>
            </div>
            {executing && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>RepoDiet is applying and verifying your selected cleanup scope. This can take a few minutes on large repositories.</span>
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
            {a2aTask.status === "completed" && a2aTask.pullRequest?.url && (
              <div className="space-y-1">
                <p className="text-signal">Cleanup pull request created</p>
                <a
                  className="font-mono text-xs text-electric underline"
                  href={a2aTask.pullRequest.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {a2aTask.pullRequest.url}
                </a>
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
              <div>
                <dt className="text-muted-foreground">Classification</dt>
                <dd className="font-mono">{showBaselineBlock.classification}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Action</dt>
                <dd>{showBaselineBlock.action}</dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">{showBaselineBlock.scanGuidance}</p>
          </div>
        )}

        {error && !showBaselineBlock && <FeedbackBanner variant="error" message={error} className="mt-3" />}

        <div className="mt-4 flex flex-wrap gap-2">
          {!quote && !hideQuoteButton && (
            <Button onClick={startQuote} disabled={loading || !githubVerified || selectedSafe.length === 0}>
              {loading ? <Loader2 className="animate-spin" /> : scopeReviewed ? "Refresh quote" : "Review cleanup scope"}
            </Button>
          )}
          {quote && a2aTask?.status === "awaiting_payment" && !hideQuoteButton && (
            <PaymentAuthorizationPanel
              quote={quote}
              loading={loading}
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
