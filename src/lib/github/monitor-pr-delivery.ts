import type { A2ATaskRecord } from "@/lib/a2a/types";
import { A2ATaskStateMachine } from "@/lib/a2a/task-state-machine";
import { saveA2ATask } from "@/lib/a2a/task-store";
import { deliverTaskCallback, persistTask } from "@/lib/a2a/callbacks";
import { markQuoteCompleted } from "@/lib/payment";
import { createExecutionReceipt } from "@/lib/execution";
import {
  buildDeliveryReceiptChecks,
  inspectPullRequestChecks,
} from "@/lib/github/pr-check-monitor";
import type { PrDeliveryMonitorRecord } from "@/lib/github/pr-check-types";
import { signExecutionReceipt } from "@/lib/operator/sign-receipt";

async function syncDeliveryTask(
  task: A2ATaskRecord,
  sm: A2ATaskStateMachine,
  status: A2ATaskRecord["status"],
  patch: Partial<A2ATaskRecord> = {}
): Promise<A2ATaskRecord> {
  sm.emit(status, "ci_monitor");
  const updated: A2ATaskRecord = {
    ...task,
    ...patch,
    status,
    transitions: sm.cloneTransitions(),
    updatedAt: new Date().toISOString(),
  };
  return persistTask(updated);
}

export async function monitorTaskPullRequestDelivery(input: {
  task: A2ATaskRecord;
  prNumber: number;
  prUrl: string;
  branch: string;
  installationId?: number;
}): Promise<A2ATaskRecord> {
  const sm = new A2ATaskStateMachine(input.task.transitions);
  let current = await syncDeliveryTask(input.task, sm, "monitoring_checks");

  const monitor = await inspectPullRequestChecks({
    owner: input.task.repository.owner,
    repo: input.task.repository.name,
    prNumber: input.prNumber,
    taskId: input.task.id,
    sourceCommitSha: input.task.repository.commitSha,
    patchCommitSha: undefined,
    installationId: input.installationId,
    poll: true,
    maxPollAttempts: 10,
    pollDelayMs: 5000,
  });

  const receiptChecks = buildDeliveryReceiptChecks(monitor);
  const signed = signExecutionReceipt(
    createExecutionReceipt({
      taskId: input.task.id,
      repository: `${input.task.repository.owner}/${input.task.repository.name}`,
      commitSha: input.task.repository.commitSha ?? monitor.sourceCommitSha,
      findingIds: input.task.input.findingIds ?? [],
      patchHash: "sha256:pr",
      verificationHash: "sha256:pr-checks",
      status: monitor.deliveryReady ? "verified" : "failed",
      quoteId: input.task.input.quoteId,
      paymentReference: input.task.input.paymentReference,
      timestamp: new Date().toISOString(),
      pullRequestUrl: input.prUrl,
    })
  );

  const receipt = {
    ...signed.signedReceipt,
    signature: signed.signature,
    signedBy: signed.signedBy,
    deliveryReady: receiptChecks.deliveryReady,
    prDelivery: receiptChecks,
  };

  const result = {
    ...current.result,
    pullRequest: {
      url: input.prUrl,
      number: input.prNumber,
      branch: input.branch,
      title: current.result.pullRequest?.title,
    },
    receipt: receipt as Record<string, unknown>,
    prDelivery: monitor as unknown as Record<string, unknown>,
  };

  if (monitor.deliveryReady) {
    sm.emit("delivery_ready", "ci_monitor");
    const finalized: A2ATaskRecord = {
      ...current,
      status: "delivery_ready",
      result,
      transitions: sm.cloneTransitions(),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    await saveA2ATask(finalized);
    await deliverTaskCallback(finalized);
    if (input.task.input.quoteId) {
      await markQuoteCompleted(input.task.input.quoteId, input.task.id);
    }
    return finalized;
  }

  const failureStatus =
    monitor.deliveryState === "owner_action_required"
      ? "owner_action_required"
      : monitor.deliveryState === "diagnosis_ready"
        ? "diagnosis_ready"
        : "checks_failed";

  const primaryDiagnosis = monitor.diagnoses[0];
  const error =
    primaryDiagnosis?.firstActionableError ??
    `Required provider checks failed for pull request #${input.prNumber}.`;

  return syncDeliveryTask(current, sm, failureStatus, {
    result,
    error,
    completedAt: new Date().toISOString(),
  });
}

export function formatPrDeliverySummary(monitor: PrDeliveryMonitorRecord): string {
  const failed = monitor.checks.filter(
    (check) => check.required && check.conclusion === "failure"
  );
  if (failed.length === 0) return "All required checks passed.";
  return failed
    .map((check) => {
      const diagnosis = monitor.diagnoses.find((entry) =>
        entry.firstActionableError.toLowerCase().includes(check.checkName.toLowerCase())
      );
      return `${check.checkName}: ${diagnosis?.firstActionableError ?? "failed"}`;
    })
    .join(" | ");
}
