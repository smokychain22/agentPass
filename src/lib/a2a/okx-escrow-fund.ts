/**
 * Bind an OKX-native A2A escrow reference and fund the cleanup task.
 * RepoDiet does not move escrow funds — OKX owns lock/release.
 * We only record the escrow reference and gate execution on that binding.
 */
import { fundA2ATask } from "./orchestrator";
import { getA2ATask, updateA2ATask } from "./task-store";
import type { A2ATaskRecord } from "./types";
import { getOkxOrderByA2aTask, updateOkxOrder } from "@/lib/okx/store";
import { getCanonicalOkxIdentity } from "@/lib/okx/identity";
import {
  getBoundQuote,
  getPaymentByReference,
  newPaymentRecord,
  savePaymentRecord,
  updateBoundQuote,
} from "@/lib/payment/payment-store";
import {
  isPreviewPaymentBlocked,
  PreviewDryRunError,
} from "@/lib/deployment/preview-dry-run";
import { durableNow } from "@/lib/store/durable-store";

export interface BindOkxEscrowInput {
  taskId: string;
  escrowReference: string;
  buyerWallet: string;
  okxAuthorizationReference?: string;
}

function normalizeEscrowReference(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 8 || trimmed.length > 200) {
    throw new Error(
      "Invalid OKX escrow reference. Paste the escrow transaction or funding reference from OKX.AI."
    );
  }
  if (/^(demo|fake|test|placeholder|0x0+$)/i.test(trimmed)) {
    throw new Error("Escrow reference looks invalid. Use the real OKX escrow funding reference.");
  }
  return trimmed;
}

function normalizeBuyerWallet(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(trimmed)) {
    throw new Error("Buyer wallet must be a valid EVM address (0x…).");
  }
  return trimmed;
}

/**
 * Record OKX escrow funding against the A2A quote, then start cleanup execution.
 */
export async function bindOkxEscrowAndFund(
  input: BindOkxEscrowInput
): Promise<A2ATaskRecord> {
  if (isPreviewPaymentBlocked()) {
    throw new PreviewDryRunError();
  }

  const task = await getA2ATask(input.taskId);
  if (!task) throw new Error("Task not found.");
  if (task.input.purchaseChannel === "direct_site") {
    throw new Error(
      "This task uses a deprecated direct-site channel. Create a new Fix & PR task on OKX A2A escrow."
    );
  }
  if (task.input.purchaseChannel !== "okx_marketplace") {
    throw new Error("OKX escrow funding requires an OKX marketplace A2A task.");
  }

  const escrowReference = normalizeEscrowReference(input.escrowReference);
  const buyerWallet = normalizeBuyerWallet(input.buyerWallet);
  const quoteId = task.input.quoteId;
  if (!quoteId) throw new Error("Task has no bound quote.");

  const quote = await getBoundQuote(quoteId);
  if (!quote) throw new Error("Quote not found.");

  // Idempotent: same escrow reference already funded this quote/task.
  const existingPayment = await getPaymentByReference(escrowReference);
  if (
    existingPayment &&
    existingPayment.lifecycleStatus === "funded" &&
    existingPayment.quoteId === quoteId &&
    (!existingPayment.taskId || existingPayment.taskId === task.id)
  ) {
    return fundA2ATask(task.id, {
      quoteId,
      paymentReference: escrowReference,
      payer: buyerWallet,
      paymentSignature: "okx:a2a_escrow",
    });
  }
  if (existingPayment && existingPayment.quoteId !== quoteId) {
    throw new Error("This escrow reference is already bound to another quote.");
  }

  const order = await getOkxOrderByA2aTask(task.id);
  if (order) {
    await updateOkxOrder(order.orderId, {
      escrowReference,
      payer: buyerWallet,
      quoteId,
      amountMicro: quote.amountMicro,
      status: "escrow_funded",
    });
  }

  const now = durableNow();
  const identity = getCanonicalOkxIdentity();
  const payment = newPaymentRecord({
    quoteId,
    paymentReference: escrowReference,
    payer: buyerWallet,
    amountMicro: quote.amountMicro,
    nonce: quote.nonce,
    taskId: task.id,
    idempotencyKey: `okx_escrow_${task.id}_${escrowReference}`,
    lifecycleStatus: "funded",
  });
  await savePaymentRecord({
    ...payment,
    id: `pay_okx_${escrowReference.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`,
  });

  await updateBoundQuote(quoteId, {
    paymentReference: escrowReference,
    payer: buyerWallet,
    paymentStatus: "verified",
    fundedAt: now,
    verifiedAt: now,
    lifecycleStatus: "funded",
    status: "funded",
    a2aTaskId: task.id,
    taskId: task.id,
  });

  await updateA2ATask(task.id, {
    result: {
      ...task.result,
      settlement: {
        ...task.result.settlement,
        escrowReference,
        buyerWallet,
        sellerWallet: identity.sellerWallet,
      },
    },
    input: {
      ...task.input,
      payer: buyerWallet,
      paymentReference: escrowReference,
    },
  });

  return fundA2ATask(task.id, {
    quoteId,
    paymentReference: escrowReference,
    payer: buyerWallet,
    paymentSignature: "okx:a2a_escrow",
  });
}
