import { deliverTaskCallback } from "./callbacks";
import { A2ATaskStateMachine } from "./task-state-machine";
import { getA2ATask, saveA2ATask } from "./task-store";
import type { A2ATaskRecord } from "./types";
import { durableNow } from "@/lib/store/durable-store";
import { markQuoteCompleted } from "@/lib/payment";

export type DirectDeliveryDecision = "accept" | "request_changes" | "reject";

export async function reviewDirectSiteDelivery(
  taskId: string,
  input: { decision: DirectDeliveryDecision; note?: string }
): Promise<A2ATaskRecord> {
  const task = await getA2ATask(taskId);
  if (!task) throw new Error("Task not found.");
  if (task.input.purchaseChannel !== "direct_site") {
    throw new Error("Marketplace delivery must be reviewed and accepted in OKX.AI.");
  }
  if (task.status === "completed" && input.decision === "accept") return task;
  if (task.status !== "delivery_ready" && task.status !== "owner_action_required") {
    throw new Error(`delivery_review_requires_ready_pr: current status is ${task.status}`);
  }

  const now = durableNow();
  const note = input.note?.trim();
  const sm = new A2ATaskStateMachine(task.transitions);
  let updated: A2ATaskRecord;

  if (input.decision === "accept") {
    sm.emit("buyer_accepted", "orchestrator", note || "Buyer accepted the direct-site delivery");
    sm.emit("completed", "orchestrator", "Direct X Layer delivery completed");
    updated = {
      ...task,
      status: "completed",
      result: {
        ...task.result,
        settlement: {
          ...task.result.settlement,
          buyerAcceptedAt: now,
          buyerWallet: task.input.payer,
        },
      },
      transitions: sm.cloneTransitions(),
      error: undefined,
      updatedAt: now,
      completedAt: now,
    };
    if (task.input.quoteId) await markQuoteCompleted(task.input.quoteId, task.id);
  } else if (input.decision === "request_changes") {
    const detail = note || "Buyer requested changes in the pull request";
    sm.emit("owner_action_required", "orchestrator", detail);
    updated = {
      ...task,
      status: "owner_action_required",
      transitions: sm.cloneTransitions(),
      error: detail,
      updatedAt: now,
      completedAt: undefined,
    };
  } else {
    const detail = note || "Buyer rejected the delivered pull request";
    sm.emit("rejected", "orchestrator", detail);
    updated = {
      ...task,
      status: "rejected",
      transitions: sm.cloneTransitions(),
      error: detail,
      updatedAt: now,
      completedAt: now,
    };
  }

  await saveA2ATask(updated);
  await deliverTaskCallback(updated);
  return updated;
}
