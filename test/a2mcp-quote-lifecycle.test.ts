import assert from "node:assert/strict";
import {
  lockQuoteForExecution,
  markQuoteSucceeded,
  releaseQuoteForRetryableFailure,
  saveBoundQuote,
  getBoundQuote,
} from "../src/lib/payment/payment-store";
import type { BoundQuote } from "../src/lib/payment/types";

function baseQuote(overrides: Partial<BoundQuote> = {}): BoundQuote {
  return {
    quoteId: `quote_test_${Date.now()}`,
    operation: "analyze_repository",
    repository: "smokychain22/agentPass",
    branch: "main",
    commitSha: "pending_scan",
    findingIds: [],
    verificationProfile: "standard",
    amount: "0.03",
    amountMicro: "30000",
    currency: "USDT",
    network: "eip155:196",
    recipient: "0x1339724ada3adf04bb7a8ccc6498216214bbdf90",
    asset: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
    nonce: "abc",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    requestHash: "sha256:deadbeef",
    bindingHash: "sha256:cafebabe",
    priceLabel: "0.03 USDT",
    status: "funded",
    lifecycleStatus: "funded",
    executionState: "FUNDED",
    createdAt: new Date().toISOString(),
    paymentStatus: "verified",
    paymentReference: "0x" + "11".repeat(32),
    payer: "0xaa895234c3fc31c40018eef975db6ac79bf87f1a",
    ...overrides,
  };
}

async function run() {
  console.log("A2MCP quote lifecycle");

  const quote = baseQuote();
  await saveBoundQuote(quote);

  const locked = await lockQuoteForExecution(quote.quoteId, "task_1", quote.paymentReference!);
  assert.equal(locked.ok, true);
  assert.equal(locked.quote?.status, "funded");
  assert.equal(locked.quote?.executionState, "EXECUTING");
  assert.notEqual(locked.quote?.status, "consumed");

  const afterTimeout = await releaseQuoteForRetryableFailure(
    quote.quoteId,
    "task_1",
    "SCAN_TIMEOUT"
  );
  assert.equal(afterTimeout?.status, "funded");
  assert.equal(afterTimeout?.executionState, "FAILED_RETRYABLE");
  assert.equal(afterTimeout?.lifecycleStatus, "funded");

  const relock = await lockQuoteForExecution(quote.quoteId, "task_2", quote.paymentReference!);
  assert.equal(relock.ok, true);
  assert.equal(relock.quote?.executionState, "EXECUTING");

  const done = await markQuoteSucceeded(quote.quoteId, "task_2", "receipt_abc");
  assert.equal(done?.status, "consumed");
  assert.equal(done?.executionState, "SUCCEEDED");
  assert.equal(done?.lifecycleStatus, "completed");
  assert.equal(done?.completedReceiptId, "receipt_abc");

  const blocked = await lockQuoteForExecution(quote.quoteId, "task_3", quote.paymentReference!);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.alreadyCompleted, true);

  const stored = await getBoundQuote(quote.quoteId);
  assert.equal(stored?.executionState, "SUCCEEDED");

  console.log("A2MCP quote lifecycle: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
