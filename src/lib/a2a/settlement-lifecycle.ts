import { getA2ATask, saveA2ATask } from "./task-store";
import { A2ATaskStateMachine } from "./task-state-machine";
import type { A2ATaskRecord } from "./types";
import {
  getOkxOrderByA2aTask,
  newDeliveryId,
  saveMarketplaceDelivery,
  updateOkxOrder,
} from "@/lib/okx/store";
import { durableNow } from "@/lib/store/durable-store";
import { markQuoteCompleted } from "@/lib/payment";
import { getCanonicalOkxIdentity } from "@/lib/okx/identity";
import { deliverTaskCallback } from "./callbacks";

/**
 * Canonical A2A Verified Cleanup PR settlement after Green PR creation:
 *
 * buyer creates A2A task
 * → seller accepts / negotiates scope (Green PR contract)
 * → funds enter escrow (OKX-native; bound via escrowReference)
 * → RepoDiet creates a real Green PR
 * → seller submits delivery evidence
 * → buyer inspects and accepts
 * → escrow releases to seller (OKX-native; recorded here)
 * → receipt and task evidence are recorded
 */

export async function submitA2aDeliveryEvidence(taskId: string): Promise<A2ATaskRecord> {
  const task = await getA2ATask(taskId);
  if (!task) throw new Error("Task not found.");
  if (task.input.purchaseChannel === "direct_site") {
    throw new Error("Direct-site delivery does not use OKX marketplace settlement.");
  }

  if (task.status === "delivery_submitted" || task.status === "buyer_accepted") {
    return task;
  }
  if (task.status === "escrow_released" || task.status === "completed") {
    return task;
  }
  if (task.status !== "delivery_ready") {
    throw new Error(
      `delivery_evidence_requires_delivery_ready: current status is ${task.status}`
    );
  }

  const order = await getOkxOrderByA2aTask(taskId);
  const deliveryId = newDeliveryId();
  const identity = getCanonicalOkxIdentity();
  const payload = {
    protocol: "A2A",
    serviceId: "32947",
    operation: "create_cleanup_pr",
    repository: `${task.repository.owner}/${task.repository.name}`,
    branch: task.repository.branch,
    pullRequest: task.result.pullRequest ?? null,
    prDelivery: task.result.prDelivery ?? null,
    receipt: task.result.receipt ?? null,
    attestation: task.result.attestation ?? null,
    maintenanceContract: task.result.maintenanceContract ?? null,
    escrowReference: order?.escrowReference ?? task.result.settlement?.escrowReference ?? null,
    submittedAt: durableNow(),
    note: "Seller delivery evidence for buyer inspection. Escrow release requires buyer acceptance.",
  };

  await saveMarketplaceDelivery({
    deliveryId,
    orderId: order?.orderId ?? `order_unbound_${taskId}`,
    taskId,
    serviceId: "verified_cleanup_pr",
    deliveryVersion: 1,
    payload,
    receiptId:
      typeof task.result.receipt?.receiptId === "string"
        ? task.result.receipt.receiptId
        : typeof task.result.receipt?.id === "string"
          ? task.result.receipt.id
          : undefined,
    createdAt: durableNow(),
  });

  if (order) {
    await updateOkxOrder(order.orderId, {
      status: "delivery_submitted",
    });
  }

  const sm = new A2ATaskStateMachine(task.transitions);
  sm.emit("delivery_submitted", "github_delivery_worker", "Delivery evidence submitted for buyer inspection");

  const updated: A2ATaskRecord = {
    ...task,
    status: "delivery_submitted",
    result: {
      ...task.result,
      settlement: {
        ...task.result.settlement,
        escrowReference: order?.escrowReference ?? task.result.settlement?.escrowReference,
        deliveryId,
        deliverySubmittedAt: durableNow(),
        sellerWallet: identity.sellerWallet,
      },
    },
    transitions: sm.cloneTransitions(),
    updatedAt: durableNow(),
    completedAt: undefined,
  };
  await saveA2ATask(updated);
  await deliverTaskCallback(updated);
  return updated;
}

export async function acceptA2aDeliveryByBuyer(
  taskId: string,
  input: { buyerWallet?: string; okxAcceptanceReference?: string } = {}
): Promise<A2ATaskRecord> {
  const task = await getA2ATask(taskId);
  if (!task) throw new Error("Task not found.");
  if (task.input.purchaseChannel === "direct_site") {
    throw new Error("Direct-site delivery must be reviewed in the RepoDiet workspace.");
  }

  if (task.status === "buyer_accepted" || task.status === "escrow_released" || task.status === "completed") {
    return task;
  }
  if (task.status === "delivery_ready") {
    await submitA2aDeliveryEvidence(taskId);
  }
  const current = (await getA2ATask(taskId))!;
  if (current.status !== "delivery_submitted") {
    throw new Error(
      `buyer_acceptance_requires_delivery_submitted: current status is ${current.status}`
    );
  }

  if (!input.buyerWallet?.trim()) throw new Error("buyer_wallet_required");
  const buyerWallet = input.buyerWallet.trim().toLowerCase();
  const order = await getOkxOrderByA2aTask(taskId);
  if (order) {
    await updateOkxOrder(order.orderId, { status: "buyer_accepted", payer: buyerWallet });
  }

  const sm = new A2ATaskStateMachine(current.transitions);
  sm.emit(
    "buyer_accepted",
    "orchestrator",
    input.okxAcceptanceReference
      ? `Buyer accepted delivery (${input.okxAcceptanceReference})`
      : "Buyer accepted delivered Green PR"
  );

  const updated: A2ATaskRecord = {
    ...current,
    status: "buyer_accepted",
    result: {
      ...current.result,
      settlement: {
        ...current.result.settlement,
        buyerAcceptedAt: durableNow(),
        buyerWallet,
      },
    },
    transitions: sm.cloneTransitions(),
    updatedAt: durableNow(),
  };
  await saveA2ATask(updated);
  await deliverTaskCallback(updated);
  return updated;
}

export async function recordA2aEscrowRelease(
  taskId: string,
  input: { escrowReleaseReference: string; sellerWallet?: string }
): Promise<A2ATaskRecord> {
  const task = await getA2ATask(taskId);
  if (!task) throw new Error("Task not found.");
  if (task.input.purchaseChannel === "direct_site") {
    throw new Error("Direct-site payment has no OKX escrow release step.");
  }

  if (task.status === "escrow_released" || task.status === "completed") {
    return task;
  }
  if (task.status !== "buyer_accepted") {
    throw new Error(
      `escrow_release_requires_buyer_accepted: current status is ${task.status}`
    );
  }
  if (!input.escrowReleaseReference?.trim()) {
    throw new Error("escrow_release_reference_required");
  }

  const identity = getCanonicalOkxIdentity();
  const sellerWallet = (input.sellerWallet ?? identity.sellerWallet).toLowerCase();
  const order = await getOkxOrderByA2aTask(taskId);
  if (order) {
    await updateOkxOrder(order.orderId, { status: "escrow_released" });
  }

  const sm = new A2ATaskStateMachine(task.transitions);
  sm.emit(
    "escrow_released",
    "orchestrator",
    `Escrow released to seller (${input.escrowReleaseReference})`
  );
  sm.emit("completed", "orchestrator", "A2A settlement complete");

  const updated: A2ATaskRecord = {
    ...task,
    status: "completed",
    result: {
      ...task.result,
      settlement: {
        ...task.result.settlement,
        escrowReleasedAt: durableNow(),
        escrowReleaseReference: input.escrowReleaseReference.trim(),
        sellerWallet,
      },
    },
    transitions: sm.cloneTransitions(),
    updatedAt: durableNow(),
    completedAt: durableNow(),
  };
  await saveA2ATask(updated);

  // Close internal entitlement only after buyer acceptance + escrow release evidence.
  if (updated.input.quoteId) {
    await markQuoteCompleted(updated.input.quoteId, updated.id);
  }

  await deliverTaskCallback(updated);
  return updated;
}

export async function rejectA2aDeliveryByBuyer(
  taskId: string,
  input: { buyerWallet?: string; reason?: string } = {}
): Promise<A2ATaskRecord> {
  const task = await getA2ATask(taskId);
  if (!task) throw new Error("Task not found.");
  if (task.input.purchaseChannel === "direct_site") {
    throw new Error("Direct-site delivery must be reviewed in the RepoDiet workspace.");
  }
  if (task.status === "rejected" || task.status === "cancelled" || task.status === "disputed") {
    return task;
  }
  if (
    ![
      "delivery_ready",
      "delivery_submitted",
      "buyer_accepted",
      "monitoring_checks",
      "checks_failed",
      "owner_action_required",
    ].includes(task.status)
  ) {
    throw new Error(`Cannot reject delivery in status ${task.status}.`);
  }

  const order = await getOkxOrderByA2aTask(taskId);
  if (order) {
    await updateOkxOrder(order.orderId, { status: "rejected" });
  }

  const sm = new A2ATaskStateMachine(task.transitions);
  sm.emit(
    "rejected",
    "orchestrator",
    input.reason?.trim() || "Buyer rejected delivered Green PR; escrow remains with OKX lifecycle."
  );

  const updated: A2ATaskRecord = {
    ...task,
    status: "rejected",
    error: input.reason?.trim() || "Buyer rejected delivery",
    result: {
      ...task.result,
      settlement: {
        ...task.result.settlement,
        buyerWallet: input.buyerWallet?.trim().toLowerCase() || task.result.settlement?.buyerWallet,
      },
    },
    transitions: sm.cloneTransitions(),
    updatedAt: durableNow(),
    completedAt: durableNow(),
  };
  await saveA2ATask(updated);
  await deliverTaskCallback(updated);
  return updated;
}

export async function disputeA2aDeliveryByBuyer(
  taskId: string,
  input: { buyerWallet?: string; reason?: string } = {}
): Promise<A2ATaskRecord> {
  const task = await getA2ATask(taskId);
  if (!task) throw new Error("Task not found.");
  if (task.input.purchaseChannel === "direct_site") {
    throw new Error("Direct-site delivery has no OKX dispute step.");
  }
  if (task.status === "disputed") return task;
  if (task.status === "completed" || task.status === "escrow_released" || task.status === "cancelled") {
    throw new Error(`Cannot dispute delivery in status ${task.status}.`);
  }

  const order = await getOkxOrderByA2aTask(taskId);
  if (order) {
    await updateOkxOrder(order.orderId, { status: "disputed" });
  }

  const sm = new A2ATaskStateMachine(task.transitions);
  sm.emit(
    "disputed",
    "orchestrator",
    input.reason?.trim() || "Buyer opened OKX dispute / arbitration for this delivery"
  );

  const updated: A2ATaskRecord = {
    ...task,
    status: "disputed",
    error: input.reason?.trim() || "Delivery disputed via OKX arbitration",
    result: {
      ...task.result,
      settlement: {
        ...task.result.settlement,
        buyerWallet: input.buyerWallet?.trim().toLowerCase() || task.result.settlement?.buyerWallet,
        disputeOpenedAt: durableNow(),
        disputeReason: input.reason?.trim(),
      },
    },
    transitions: sm.cloneTransitions(),
    updatedAt: durableNow(),
  };
  await saveA2ATask(updated);
  await deliverTaskCallback(updated);
  return updated;
}

export function describeA2aLifecycle(): string[] {
  return [
    "buyer creates A2A task",
    "seller accepts or negotiates scope",
    "funds enter escrow",
    "RepoDiet creates a real Green PR",
    "seller submits delivery evidence",
    "buyer inspects and accepts",
    "escrow releases to seller",
    "receipt and task evidence are recorded",
  ];
}
