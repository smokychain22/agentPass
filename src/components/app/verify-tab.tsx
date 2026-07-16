"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, ExternalLink, Loader2, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/design-system/panel";
import { useAppSession } from "@/components/app/app-session";
import { LockedTab, WorkspaceSection } from "@/components/app/locked-tab";
import { computeWorkflowGates } from "@/lib/workflow/gates";
import {
  fetchWorkflowA2ATask,
  fetchPrDeliveryMonitor,
  reviewWorkflowDelivery,
  retryPrDeliveryChecks,
  type PrDeliveryMonitor,
} from "@/lib/workflow/client";
import { cn } from "@/lib/utils";
import { resolveOkxAgentUrl } from "@/lib/wallet/okx-agent-url";

const TIMELINE_STEPS = [
  { label: "Payment verified", evidence: ["funded"] },
  { label: "Scope locked", evidence: ["awaiting_approval"] },
  { label: "Isolated branch created", evidence: ["creating_pull_request"] },
  { label: "Approved changes applied", evidence: ["generating_changes"] },
  { label: "Patch validated", evidence: ["validating_patch"] },
  { label: "Verification completed", evidence: ["verifying"] },
  { label: "Pull request created", evidence: ["monitoring_checks"] },
  { label: "Required checks passed", evidence: ["delivery_ready", "delivery_submitted", "buyer_accepted", "completed"] },
  { label: "Buyer accepted delivery", evidence: ["buyer_accepted", "completed"] },
] as const;

function stepDone(
  transitions: Array<{ status: string }>,
  evidence: readonly string[]
): boolean {
  const observed = new Set(transitions.map((transition) => transition.status));
  return evidence.some((status) => observed.has(status));
}

function checkIcon(conclusion: string | null | undefined, pending: boolean) {
  if (pending) return <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-electric" aria-hidden />;
  if (conclusion === "success") {
    return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-signal" aria-hidden />;
  }
  if (conclusion === "failure" || conclusion === "timed_out" || conclusion === "action_required") {
    return <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden />;
  }
  return <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />;
}

function cleanupCausedLabel(value: boolean | "unknown"): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "Unknown";
}

export function VerifyTab() {
  const { session, findings, patchKit, a2aTask, setA2aTask } = useAppSession();
  const [monitor, setMonitor] = useState<PrDeliveryMonitor | null>(null);
  const [loadingChecks, setLoadingChecks] = useState(false);
  const [retryLoading, setRetryLoading] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const gates = useMemo(
    () =>
      computeWorkflowGates({
        scanComplete: session.scanComplete,
        findings,
        patchKit,
        a2aTask: a2aTask ? { id: a2aTask.taskId, status: a2aTask.status } : null,
      }),
    [session.scanComplete, findings, patchKit, a2aTask]
  );

  const task = a2aTask;
  const receipt = (task?.receipt ?? {}) as Record<string, unknown>;
  const failed =
    task?.status === "verification_failed" ||
    task?.status === "delivery_failed" ||
    task?.status === "checks_failed" ||
    task?.status === "owner_action_required";

  const prDelivery = (task?.prDelivery as PrDeliveryMonitor | undefined) ?? monitor;
  const requiredChecks = prDelivery?.checks.filter((check) => check.required) ?? [];
  const requiredChecksPassed =
    requiredChecks.length === 0
      ? Boolean(prDelivery?.deliveryReady)
      : requiredChecks.every(
          (check) => check.status === "completed" && check.conclusion === "success"
        );
  const mergeReady = Boolean(task?.pullRequest?.url && prDelivery?.deliveryReady && requiredChecksPassed);
  const marketplace = task?.purchaseChannel === "okx_marketplace";
  const okxUrl = resolveOkxAgentUrl();

  const refreshChecks = useCallback(async () => {
    if (!task?.pullRequest?.number) return;
    setLoadingChecks(true);
    setCheckError(null);
    try {
      const { monitor: next } = await fetchPrDeliveryMonitor({
        owner: task.repository.owner,
        repo: task.repository.name,
        prNumber: task.pullRequest.number,
        taskId: task.taskId,
        poll: true,
      });
      setMonitor(next);
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : "Could not refresh check diagnostics.");
    } finally {
      setLoadingChecks(false);
    }
  }, [task?.pullRequest?.number, task?.repository.name, task?.repository.owner, task?.taskId]);

  useEffect(() => {
    if (!task?.pullRequest?.number || prDelivery) return;
    void refreshChecks();
  }, [prDelivery, refreshChecks, task?.pullRequest?.number]);

  if (!gates.verifyUnlocked) {
    return (
      <LockedTab
        step="04"
        title="Review & Accept"
        description="Review & Accept unlocks after paid cleanup execution starts or a previous delivery exists."
      />
    );
  }

  const handleRetry = async () => {
    if (!task?.pullRequest?.number) return;
    setRetryLoading(true);
    try {
      const result = await retryPrDeliveryChecks({
        owner: task.repository.owner,
        repo: task.repository.name,
        prNumber: task.pullRequest.number,
        taskId: task.taskId,
      });
      setMonitor(result.monitor);
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : "Retry failed.");
    } finally {
      setRetryLoading(false);
    }
  };

  const handleReview = async (decision: "accept" | "request_changes" | "reject") => {
    if (!task || marketplace) return;
    let note: string | undefined;
    if (decision === "request_changes") {
      const response = window.prompt("What should RepoDiet change in this pull request?");
      if (response === null) return;
      note = response.trim() || "Buyer requested changes in the pull request";
    }
    if (decision === "reject") {
      const confirmed = window.confirm(
        "Reject this delivery? This records the decision but does not reverse a direct X Layer transfer."
      );
      if (!confirmed) return;
    }
    setReviewLoading(true);
    setReviewError(null);
    try {
      setA2aTask(await reviewWorkflowDelivery({ taskId: task.taskId, decision, note }));
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : "Could not record delivery review.");
    } finally {
      setReviewLoading(false);
    }
  };

  const syncTask = async () => {
    if (!task) return;
    setReviewLoading(true);
    setReviewError(null);
    try {
      const refreshed = await fetchWorkflowA2ATask(task.taskId);
      setA2aTask(refreshed.task);
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : "Could not sync delivery status.");
    } finally {
      setReviewLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <WorkspaceSection
        label="Delivery evidence"
        title="Review & Accept"
        description="Inspect the exact cleanup, required checks, and delivery evidence before you accept or merge anything."
      />

      <Panel variant="elevated" padding="md">
        <p className="ds-label mb-3">Execution timeline</p>
        <ol className="space-y-2 text-sm">
          {TIMELINE_STEPS.map((step, index) => {
            const done = task ? stepDone(task.transitions, step.evidence) : false;
            const failedHere = failed && index >= 7;
            return (
              <li key={step.label} className="flex items-start gap-2">
                {failedHere ? (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden />
                ) : done ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-signal" aria-hidden />
                ) : (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className={cn(done && !failedHere && "text-signal")}>{step.label}</span>
              </li>
            );
          })}
        </ol>
      </Panel>

      {task && (
        <Panel variant="elevated" padding="md">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Task ID</dt>
              <dd className="font-mono text-xs">{task.taskId}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Delivery state</dt>
              <dd>{task.status.replaceAll("_", " ")}</dd>
            </div>
            {task.pullRequest?.url && (
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Pull request</dt>
                <dd>
                  <a href={task.pullRequest.url} className="text-electric underline" target="_blank" rel="noreferrer">
                    {task.pullRequest.url}
                  </a>
                </dd>
              </div>
            )}
            <div>
              <dt className="text-muted-foreground">Payment route</dt>
              <dd>{marketplace ? "OKX.AI marketplace" : "Direct X Layer payment"}</dd>
            </div>
            {typeof receipt.receiptId === "string" && (
              <div>
                <dt className="text-muted-foreground">Receipt ID</dt>
                <dd className="font-mono text-xs">{receipt.receiptId}</dd>
              </div>
            )}
          </dl>
        </Panel>
      )}

      {prDelivery && (
        <>
          <Panel variant="elevated" padding="md">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="ds-label">Required checks</p>
              <Button variant="secondary" size="sm" onClick={() => void refreshChecks()} disabled={loadingChecks}>
                {loadingChecks ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                <span className="ml-2">Re-run verification</span>
              </Button>
            </div>
            <ul className="space-y-2 text-sm">
              {prDelivery.checks.map((check) => {
                const pending = check.status !== "completed";
                return (
                  <li key={check.checkName} className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2">
                      {checkIcon(check.conclusion, pending)}
                      <div>
                        <p>
                          {check.provider === "vercel" ? "Vercel" : check.provider} {check.checkName}
                          {check.required ? "" : " (optional)"}
                          {": "}
                          <span className="font-mono text-xs">
                            {pending ? check.status.toUpperCase() : (check.conclusion ?? "unknown").toUpperCase()}
                          </span>
                        </p>
                      </div>
                    </div>
                    {check.detailsUrl && (
                      <a
                        href={check.detailsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-electric underline"
                      >
                        Open provider logs
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          </Panel>

          {prDelivery.vercelProjects && prDelivery.vercelProjects.projects.length > 1 && (
            <Panel variant="elevated" padding="md">
              <p className="ds-label mb-3">Connected Vercel projects</p>
              <ul className="space-y-2 text-sm">
                {prDelivery.vercelProjects.projects.map((project) => (
                  <li key={project.name}>
                    <span className="font-mono">{project.name}</span>
                    {" — "}
                    {project.likelyCanonical ? "likely canonical" : "review"}
                    {". "}
                    {project.reason}
                  </li>
                ))}
              </ul>
              {prDelivery.vercelProjects.ownerAction && (
                <p className="mt-3 text-sm text-amber-200">{prDelivery.vercelProjects.ownerAction}</p>
              )}
            </Panel>
          )}

          {prDelivery.diagnoses.length > 0 && (
            <Panel variant="elevated" padding="md">
              <p className="ds-label mb-3">Diagnosis</p>
              <div className="space-y-4 text-sm">
                {prDelivery.diagnoses.map((diagnosis) => (
                  <div key={diagnosis.firstActionableError} className="rounded-md border border-border/60 p-3">
                    <p className="font-mono text-xs text-red-300">{diagnosis.firstActionableError}</p>
                    <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                      <div>
                        <dt className="text-muted-foreground">Classification</dt>
                        <dd>{diagnosis.classification}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">RepoDiet caused this</dt>
                        <dd>{cleanupCausedLabel(diagnosis.cleanupCausedThis)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Confidence</dt>
                        <dd>{diagnosis.confidence}</dd>
                      </div>
                      {diagnosis.affectedFile && (
                        <div>
                          <dt className="text-muted-foreground">Affected file</dt>
                          <dd className="font-mono text-xs">{diagnosis.affectedFile}</dd>
                        </div>
                      )}
                    </dl>
                    <p className="mt-2 text-muted-foreground">{diagnosis.recommendedAction}</p>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {prDelivery.ownerActions.length > 0 && (
            <Panel variant="elevated" padding="md">
              <p className="ds-label mb-2">Owner actions</p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-amber-100">
                {prDelivery.ownerActions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}

      {task?.pullRequest?.url && (
        <Panel variant="elevated" padding="md">
          <p className="ds-label mb-3">Merge readiness</p>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Pull request</dt>
              <dd>#{task.pullRequest.number ?? "—"} opened from {task.pullRequest.branch ?? "cleanup branch"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Changed files</dt>
              <dd>{task.changes?.changedFiles?.length ?? task.approval?.changes?.length ?? "—"}</dd>
            </div>
            {prDelivery?.baseSha && (
              <div>
                <dt className="text-muted-foreground">Base commit</dt>
                <dd className="font-mono text-xs">{prDelivery.baseSha.slice(0, 12)}</dd>
              </div>
            )}
            {prDelivery?.headSha && (
              <div>
                <dt className="text-muted-foreground">PR head commit</dt>
                <dd className="font-mono text-xs">{prDelivery.headSha.slice(0, 12)}</dd>
              </div>
            )}
            <div>
              <dt className="text-muted-foreground">Required checks</dt>
              <dd>{requiredChecksPassed ? "Passed" : "Not yet passed"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">RepoDiet delivery</dt>
              <dd>{mergeReady ? "Ready for owner review" : "Not ready to merge"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Merge control</dt>
              <dd>Repository owner only; RepoDiet never merges automatically</dd>
            </div>
          </dl>
          <Button asChild className="mt-4" variant={mergeReady ? "default" : "secondary"}>
            <a href={task.pullRequest.url} target="_blank" rel="noreferrer">
              {mergeReady ? "Open PR to merge" : "Review pull request"}
              <ExternalLink className="ml-2 h-4 w-4" />
            </a>
          </Button>
        </Panel>
      )}

      {task && (task.status === "delivery_ready" || task.status === "delivery_submitted" || task.status === "buyer_accepted" || task.status === "owner_action_required" || task.status === "completed") && (
        <Panel variant="elevated" padding="md">
          <p className="ds-label mb-2">Buyer decision</p>
          {marketplace ? (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                This order was purchased through OKX.AI. Accept, request changes, reject, and
                escrow release must remain in the official marketplace task. RepoDiet will not
                simulate those actions on this website.
              </p>
              <div className="flex flex-wrap gap-2">
                {okxUrl && (
                  <Button asChild>
                    <a href={okxUrl} target="_blank" rel="noreferrer">Review in OKX.AI</a>
                  </Button>
                )}
                <Button variant="secondary" onClick={() => void syncTask()} disabled={reviewLoading}>
                  {reviewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  <span className="ml-2">Sync marketplace status</span>
                </Button>
              </div>
              {!okxUrl && <p className="text-xs text-muted-foreground">Open your OKX.AI Agentic Wallet task and find RepoDiet ASP 5283.</p>}
            </div>
          ) : task.status === "completed" ? (
            <p className="text-sm text-signal">Delivery accepted. The direct X Layer payment was settled when it was sent.</p>
          ) : (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                Accept only after the pull request matches the agreed scope and all required
                checks pass. A direct payment is not OKX escrow and is not automatically reversed
                by rejecting a delivery.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void handleReview("accept")} disabled={reviewLoading || !mergeReady}>
                  {reviewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Accept delivery
                </Button>
                <Button variant="secondary" onClick={() => void handleReview("request_changes")} disabled={reviewLoading}>
                  Request changes
                </Button>
                <Button variant="destructive" onClick={() => void handleReview("reject")} disabled={reviewLoading}>
                  Reject delivery
                </Button>
              </div>
            </div>
          )}
          {reviewError && <p className="mt-3 text-sm text-red-300">{reviewError}</p>}
        </Panel>
      )}

      {checkError && <p className="text-sm text-red-300">{checkError}</p>}
      {task?.error && <p className="text-sm text-red-300">Failed check: {task.error}</p>}

      <div className="flex flex-wrap gap-2">
        {task?.pullRequest?.number && (
          <Button variant="secondary" onClick={() => void handleRetry()} disabled={retryLoading}>
            {retryLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Retry failed checks
          </Button>
        )}
        <Button variant="secondary" asChild>
          <Link href="/app?tab=patch">Back to Fix & PR</Link>
        </Button>
      </div>
    </div>
  );
}
