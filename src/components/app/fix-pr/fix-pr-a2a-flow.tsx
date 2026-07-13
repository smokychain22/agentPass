"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/design-system/panel";
import { FeedbackBanner } from "@/components/app/ui/feedback-banner";
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
  const [error, setError] = useState<string | null>(null);
  const [payer, setPayer] = useState("");
  const [paymentRef, setPaymentRef] = useState("");

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
    const terminal = new Set(["completed", "payment_failed", "verification_failed", "delivery_failed"]);
    if (terminal.has(a2aTask.status)) return;

    const poll = async () => {
      try {
        const { task, quote: q } = await fetchWorkflowA2ATask(a2aTask.taskId);
        onTaskUpdate(task);
        if (q) setQuote(q);
        if (task.status === "awaiting_approval") {
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
      setError(err instanceof Error ? err.message : "Failed to prepare quote.");
    } finally {
      setLoading(false);
    }
  }, [branch, commitSha, findings.scanId, onScopeReviewed, onTaskUpdate, repoUrl, selectedSafe]);

  const authorizePayment = useCallback(async () => {
    if (!quote || !a2aTask?.taskId || !payer.trim() || !paymentRef.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await payWorkflowQuote({
        quoteId: quote.quoteId,
        paymentReference: paymentRef.trim(),
        payer: payer.trim(),
      });
      const funded = await fundWorkflowTask({
        taskId: a2aTask.taskId,
        quoteId: quote.quoteId,
        paymentReference: paymentRef.trim(),
        payer: payer.trim(),
      });
      onTaskUpdate(funded);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed.");
    } finally {
      setLoading(false);
    }
  }, [a2aTask?.taskId, onTaskUpdate, payer, paymentRef, quote]);

  return (
    <div className="space-y-4">
      <Panel variant="elevated" padding="md">
        <p className="ds-label mb-3">Repository connection</p>
        {github?.connected ? (
          <div className="space-y-1 text-sm">
            <p className="text-signal">GitHub connected</p>
            <p className="text-muted-foreground">Branch and pull-request access confirmed</p>
          </div>
        ) : github?.configured === false ? (
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
            <Button asChild size="sm">
              <a href="/api/github/install/start">
                {github?.messages?.primaryAction ?? "Connect GitHub"}
              </a>
            </Button>
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
          <p className="mt-3 font-mono text-xs text-muted-foreground">
            Task {a2aTask.taskId} · {a2aTask.status}
          </p>
        )}

        {error && <FeedbackBanner variant="error" message={error} className="mt-3" />}

        <div className="mt-4 flex flex-wrap gap-2">
          {!quote && (
            <Button onClick={startQuote} disabled={loading || !github?.connected || selectedSafe.length === 0}>
              {loading ? <Loader2 className="animate-spin" /> : scopeReviewed ? "Refresh quote" : "Review cleanup scope"}
            </Button>
          )}
          {quote && a2aTask?.status === "awaiting_payment" && (
            <>
              <input
                className="min-w-[200px] flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
                placeholder="Buyer wallet (0x…)"
                value={payer}
                onChange={(e) => setPayer(e.target.value)}
              />
              <input
                className="min-w-[200px] flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
                placeholder="Payment reference (0x…)"
                value={paymentRef}
                onChange={(e) => setPaymentRef(e.target.value)}
              />
              <Button onClick={authorizePayment} disabled={loading}>
                {loading ? <Loader2 className="animate-spin" /> : "Authorize and create cleanup PR"}
              </Button>
            </>
          )}
          <Button variant="secondary" asChild>
            <Link href="/app?tab=findings">Back to findings</Link>
          </Button>
        </div>
      </Panel>
    </div>
  );
}
