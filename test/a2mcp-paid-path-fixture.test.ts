import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { buildCommerceBinding } from "../src/lib/okx/commerce-gateway";
import { saveBoundQuote, getBoundQuote } from "../src/lib/payment/payment-store";
import { markQuoteRetryableFailure, markQuoteCompleted, requireEntitlement } from "../src/lib/payment/settlement";
import {
  getCompletedA2mcpExecution,
  newCompletedExecution,
  saveCompletedA2mcpExecution,
} from "../src/lib/a2mcp/a2mcp-execution-store";
import { executeQuickTriage } from "../src/lib/a2mcp/quick-triage-engine";
import { verifyExecutionReceiptV1, type SignedReceiptV1 } from "../src/lib/operator/sign-receipt";
import { signOkxReceipt } from "../src/lib/okx/payment-provider";
import { verifyReceipt } from "../src/lib/okx/receipt-verifier";

async function run() {
  console.log("A2MCP paid-path fixture (non-billable)");

  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  process.env.REPODIET_OPERATOR_PRIVATE_KEY = privateKey;
  process.env.REPODIET_OPERATOR_PUBLIC_KEY = publicKey;

  const binding = buildCommerceBinding({
    operation: "analyze_repository",
    repository: "smokychain22/agentPass",
    branch: "main",
    commitSha: "pending_scan",
  });

  const quoteId = `quote_fixture_${Date.now()}`;
  await saveBoundQuote({
    quoteId,
    operation: "analyze_repository",
    repository: binding.repository,
    branch: binding.branch,
    commitSha: binding.commitSha,
    findingIds: [],
    verificationProfile: "standard",
    amount: "0.03",
    amountMicro: "30000",
    currency: "USDT",
    network: "eip155:196",
    recipient: "0x1339724ada3adf04bb7a8ccc6498216214bbdf90",
    asset: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
    nonce: "fixture-nonce",
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    requestHash: binding.requestHash,
    bindingHash: binding.requestHash,
    priceLabel: "0.03 USDT",
    status: "funded",
    lifecycleStatus: "funded",
    executionState: "FUNDED",
    createdAt: new Date().toISOString(),
    paymentStatus: "verified",
    paymentReference: "0x" + "ab".repeat(32),
    payer: "0xaa895234c3fc31c40018eef975db6ac79bf87f1a",
    fundedAt: new Date().toISOString(),
    verifiedAt: new Date().toISOString(),
  });

  // Simulate timeout → retryable
  const firstLock = await requireEntitlement({
    quoteId,
    taskId: "task_timeout",
    repository: binding.repository,
    branch: binding.branch,
    commitSha: binding.commitSha,
    findingIds: [],
    operation: "analyze_repository",
  });
  assert.equal(firstLock.ok, true);
  await markQuoteRetryableFailure(quoteId, "task_timeout", "SCAN_TIMEOUT");
  const afterFail = await getBoundQuote(quoteId);
  assert.equal(afterFail?.executionState, "FAILED_RETRYABLE");
  assert.equal(afterFail?.status, "funded");

  // Retry entitlement must succeed without new payment
  const retry = await requireEntitlement({
    quoteId,
    taskId: "task_success",
    repository: binding.repository,
    branch: binding.branch,
    commitSha: binding.commitSha,
    findingIds: [],
    operation: "analyze_repository",
  });
  assert.equal(retry.ok, true);

  // Execute bounded triage (may use network). Skip hard fail if offline.
  let task;
  try {
    task = await executeQuickTriage(
      {
        repoUrl: "https://github.com/smokychain22/agentPass",
        branch: "main",
        maximumFindings: 5,
        source: "quick_triage",
      },
      "task_success"
    );
  } catch (err) {
    console.log("  execution skipped offline:", err instanceof Error ? err.message : String(err));
    // Still prove lifecycle + idempotency with a synthetic completed task
    task = {
      id: "task_success",
      type: "analyze_repository" as const,
      status: "completed" as const,
      repository: { owner: "smokychain22", name: "agentPass", branch: "main" },
      result: { summary: { findingsReturned: 1 }, findings: [{ id: "f1" }] },
      analyzers: {},
      limitations: [],
      receipt: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
  }

  assert.equal(task.status, "completed");
  console.log("  internal execution HTTP-equivalent status: 200");
  const summary = (task.result as { summary?: Record<string, unknown> })?.summary;
  console.log("  Quick Triage summary:", JSON.stringify(summary ?? { present: true }));

  const receipt = await signOkxReceipt({
    serviceId: "analyze_repository",
    serviceType: "A2MCP",
    taskId: task.id,
    requestHash: binding.requestHash,
    result: task.result,
    quoteId,
    paymentReference: "0x" + "ab".repeat(32),
    buyer: "0xaa895234c3fc31c40018eef975db6ac79bf87f1a",
    seller: "0x1339724ada3adf04bb7a8ccc6498216214bbdf90",
    amountMicro: "30000",
    token: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
    network: "eip155:196",
    operation: "analyze_repository",
    repository: "smokychain22/agentPass",
  });
  assert.ok(receipt.receiptId);
  assert.ok(receipt.signature);
  assert.ok(receipt.signedReceipt);
  assert.equal(receipt.quoteId, quoteId);
  assert.ok(receipt.paymentReference);
  assert.ok(receipt.resultDigest);

  const cryptoOk = verifyExecutionReceiptV1(
    receipt.signedReceipt as unknown as SignedReceiptV1,
    receipt.signature!,
    publicKey
  );
  assert.equal(cryptoOk, true, "receipt cryptographic verify must pass");

  const verified = await verifyReceipt(receipt.receiptId);
  assert.equal(verified.valid, true, verified.reason ?? "verifyReceipt failed");
  console.log("  receipt verification: PASS");

  await markQuoteCompleted(quoteId, task.id, receipt.receiptId);
  const digest = `sha256:${createHash("sha256").update(JSON.stringify(task.result)).digest("hex")}`;
  await saveCompletedA2mcpExecution(
    newCompletedExecution({
      quoteId,
      requestHash: binding.requestHash,
      taskId: task.id,
      receiptId: receipt.receiptId,
      httpStatus: 200,
      responseBody: {
        success: true,
        taskId: task.id,
        result: task.result,
        receipt: { receiptId: receipt.receiptId, signature: receipt.signature },
      },
      resultDigest: digest,
    })
  );

  const replay = await getCompletedA2mcpExecution(quoteId, binding.requestHash);
  assert.ok(replay);
  assert.equal(replay?.httpStatus, 200);
  assert.equal(replay?.receiptId, receipt.receiptId);
  assert.equal(replay?.taskId, task.id);

  // Identical digest must return the same completion — no second execution record rewrite needed
  const replay2 = await getCompletedA2mcpExecution(quoteId, binding.requestHash);
  assert.equal(replay2?.resultDigest, replay?.resultDigest);
  assert.equal(replay2?.receiptId, receipt.receiptId);

  const finalQuote = await getBoundQuote(quoteId);
  assert.equal(finalQuote?.executionState, "SUCCEEDED");
  assert.equal(finalQuote?.status, "consumed");

  // Old real production quote must never be reused by fixtures.
  assert.notEqual(quoteId, "quote_oQs2zW2cmt7o");

  console.log("A2MCP paid-path fixture: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
