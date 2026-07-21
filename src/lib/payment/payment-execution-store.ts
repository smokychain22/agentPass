/**
 * Durable payment execution records for exact-once A2MCP settlement + result delivery.
 * No secrets: signatures and private keys are never persisted here.
 */

import { durableId, durableNow, getDurableRecord, setDurableRecord } from "@/lib/store/durable-store";

export type PaymentExecutionStatus =
  | "created"
  | "verified"
  | "settled"
  | "executing"
  | "completed"
  | "failed_retryable"
  | "failed_terminal";

export interface PaymentExecutionRecord {
  executionId: string;
  requestHash: string;
  normalizedRepository: string;
  commitSha: string | null;
  paymentMethod: string;
  network: string;
  asset: string;
  amount: string;
  payer: string | null;
  payee: string;
  paymentId: string;
  authorizationNonce: string | null;
  verificationStatus: "pending" | "verified" | "rejected";
  settlementStatus: "pending" | "settled" | "failed" | "skipped";
  transactionHash: string | null;
  resultHash: string | null;
  receiptId: string | null;
  quoteId: string | null;
  applicationCommit: string | null;
  status: PaymentExecutionStatus;
  createdAt: string;
  verifiedAt: string | null;
  settledAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

function paymentIdentityKey(paymentId: string): string {
  return `payid:${paymentId}`;
}

export async function getPaymentExecutionByPaymentId(
  paymentId: string
): Promise<PaymentExecutionRecord | undefined> {
  const mapped = await getDurableRecord<{ executionId: string }>(
    "a2mcp_payment_identity",
    paymentIdentityKey(paymentId)
  );
  if (!mapped?.executionId) return undefined;
  return getDurableRecord<PaymentExecutionRecord>("a2mcp_payment_executions", mapped.executionId);
}

export async function getPaymentExecution(
  executionId: string
): Promise<PaymentExecutionRecord | undefined> {
  return getDurableRecord<PaymentExecutionRecord>("a2mcp_payment_executions", executionId);
}

/**
 * Atomically claim a payment identity. Returns existing record if already claimed.
 */
export async function claimPaymentExecution(input: {
  requestHash: string;
  normalizedRepository: string;
  commitSha: string | null;
  paymentMethod: string;
  network: string;
  asset: string;
  amount: string;
  payer: string | null;
  payee: string;
  paymentId: string;
  authorizationNonce?: string | null;
  quoteId?: string | null;
}): Promise<{ record: PaymentExecutionRecord; created: boolean }> {
  const existing = await getPaymentExecutionByPaymentId(input.paymentId);
  if (existing) {
    if (existing.requestHash !== input.requestHash) {
      const err = new Error(
        "PAYMENT_PROOF_REQUEST_MISMATCH: payment identity already bound to a different request hash."
      );
      (err as Error & { code: string }).code = "PAYMENT_PROOF_REQUEST_MISMATCH";
      throw err;
    }
    return { record: existing, created: false };
  }

  const now = durableNow();
  const executionId = durableId("a2mcp_exec");
  const record: PaymentExecutionRecord = {
    executionId,
    requestHash: input.requestHash,
    normalizedRepository: input.normalizedRepository,
    commitSha: input.commitSha,
    paymentMethod: input.paymentMethod,
    network: input.network,
    asset: input.asset,
    amount: input.amount,
    payer: input.payer,
    payee: input.payee,
    paymentId: input.paymentId,
    authorizationNonce: input.authorizationNonce ?? null,
    verificationStatus: "pending",
    settlementStatus: "pending",
    transactionHash: null,
    resultHash: null,
    receiptId: null,
    quoteId: input.quoteId ?? null,
    applicationCommit:
      process.env.VERCEL_GIT_COMMIT_SHA ||
      process.env.GIT_COMMIT_SHA ||
      process.env.COMMIT_SHA ||
      null,
    status: "created",
    createdAt: now,
    verifiedAt: null,
    settledAt: null,
    completedAt: null,
    updatedAt: now,
  };

  // Uniqueness guard on payment identity — if a concurrent writer won, reload.
  const priorMap = await getDurableRecord<{ executionId: string }>(
    "a2mcp_payment_identity",
    paymentIdentityKey(input.paymentId)
  );
  if (priorMap?.executionId) {
    const raced = await getPaymentExecution(priorMap.executionId);
    if (raced) {
      if (raced.requestHash !== input.requestHash) {
        const err = new Error(
          "PAYMENT_PROOF_REQUEST_MISMATCH: payment identity already bound to a different request hash."
        );
        (err as Error & { code: string }).code = "PAYMENT_PROOF_REQUEST_MISMATCH";
        throw err;
      }
      return { record: raced, created: false };
    }
  }

  await setDurableRecord("a2mcp_payment_identity", paymentIdentityKey(input.paymentId), {
    executionId,
  });
  await setDurableRecord("a2mcp_payment_executions", executionId, record);
  return { record, created: true };
}

export async function updatePaymentExecution(
  executionId: string,
  patch: Partial<PaymentExecutionRecord>
): Promise<PaymentExecutionRecord | undefined> {
  const existing = await getPaymentExecution(executionId);
  if (!existing) return undefined;
  const updated: PaymentExecutionRecord = {
    ...existing,
    ...patch,
    updatedAt: durableNow(),
  };
  await setDurableRecord("a2mcp_payment_executions", executionId, updated);
  return updated;
}
