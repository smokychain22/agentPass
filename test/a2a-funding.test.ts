import assert from "node:assert/strict";
import { mapTaskTypeToOperation } from "../src/lib/a2a/types";
import {
  A2A_FUNDABLE_STATUSES,
  hydrateVerifiedQuoteFromPayment,
  isQuoteVerified,
  validateVerifiedQuoteForA2aFund,
} from "../src/lib/a2a/a2a-funding";
import type { A2ATaskRecord } from "../src/lib/a2a/types";
import { X402_ASSET, X402_CURRENCY, X402_NETWORK, X402_RECIPIENT } from "../src/lib/payment/constants";
import {
  claimA2aFundLock,
  getA2aFundLock,
  getPaymentByQuoteId,
  isA2aFundLockExpired,
  markA2aFundExecutionQueued,
  newPaymentRecord,
  releaseA2aFundLockIfToken,
  saveBoundQuote,
  savePaymentRecord,
  A2A_FUND_LOCK_TTL_MS,
} from "../src/lib/payment/payment-store";
import { createBoundQuote, signTestPaymentPayload } from "../src/lib/payment/quote-service";
import { verifyAndFundQuote } from "../src/lib/payment/settlement";
import type { BoundQuote } from "../src/lib/payment/types";
import { resolveCommercePrice } from "../src/lib/pricing/commerce-price";
import { getAnalyzeRepositoryPrice } from "../src/lib/payment/analyze-repository-price";
import { priceForOperation } from "../src/lib/payment/quote-service";

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    await fn();
    console.log(`  ✓ ${name}`);
  })();
}

function withEnv(key: string, value: string | undefined, fn: () => void | Promise<void>) {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  return (async () => {
    try {
      await fn();
    } finally {
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    }
  })();
}

function baseTask(overrides: Partial<A2ATaskRecord> = {}): A2ATaskRecord {
  const now = new Date().toISOString();
  return {
    id: "task_test_fund",
    type: "repository.verified_cleanup",
    status: "awaiting_payment",
    repository: { owner: "repodiet", name: "demo-slop-app", branch: "main" },
    input: { repoUrl: "https://github.com/repodiet/demo-slop-app", quoteId: "quote_test_fund" },
    result: {},
    transitions: [{ status: "awaiting_payment", at: now, role: "orchestrator" }],
    limitations: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function fundedQuoteFixture(
  patch: Partial<BoundQuote> = {},
  options?: { verified?: boolean; legacy?: boolean }
): Promise<BoundQuote> {
  const quote = await createBoundQuote({
    repository: "repodiet/demo-slop-app",
    branch: "main",
    commitSha: "abc123",
    findingIds: ["f1"],
    operation: "verified_cleanup_pr",
    sourceFileCount: 100,
  });
  const paymentReference = patch.paymentReference ?? `0xtest_${quote.quoteId}`;
  const payer = patch.payer ?? "0xaa895234c3fc31c40018eef975db6ac79bf87f1a";
  const funded: BoundQuote = {
    ...quote,
    lifecycleStatus: "funded",
    status: "funded",
    paymentReference,
    payer,
    a2aTaskId: "task_test_fund",
    ...(options?.legacy
      ? {}
      : {
          paymentStatus: "verified" as const,
          fundedAt: new Date().toISOString(),
          verifiedAt: new Date().toISOString(),
        }),
    ...patch,
  };
  await saveBoundQuote(funded);
  if (options?.verified !== false) {
    await savePaymentRecord(
      newPaymentRecord({
        quoteId: funded.quoteId,
        paymentReference,
        payer,
        amountMicro: funded.amountMicro,
        nonce: funded.nonce,
        idempotencyKey: `idem_${funded.quoteId}`,
        lifecycleStatus: "funded",
      })
    );
  }
  return funded;
}

async function run() {
  console.log("a2a-funding tests");

  await test("1. unfunded quote without signature returns payment required", async () => {
    const quote = await createBoundQuote({
      repository: "repodiet/demo-slop-app",
      branch: "main",
      commitSha: "abc",
      findingIds: [],
      operation: "verified_cleanup_pr",
    });
    const task = baseTask({ input: { repoUrl: "https://github.com/repodiet/demo-slop-app", quoteId: quote.quoteId } });
    const result = await validateVerifiedQuoteForA2aFund({ task, quote, expectedQuoteId: quote.quoteId });
    assert.equal(result.ok, false);
    assert.equal(result.code, "quote_not_funded");
  });

  await test("2. valid signature verifies and funds the quote", async () => {
    process.env.ALLOW_INTERNAL_TEST_BUYER = "1";
    process.env.REPODIET_X402_TEST_MODE = "1";
    process.env.REPODIET_X402_TEST_SECRET = "test-secret";
    const quote = await createBoundQuote({
      repository: "owner/repo",
      branch: "main",
      commitSha: "sha",
      findingIds: [],
      operation: "quick_cleanup",
    });
    const paymentReference = `0xtest_${quote.quoteId}`;
    const payer = "0x0000000000000000000000000000000000000001";
    const paymentSignature =
      signTestPaymentPayload({
        quoteId: quote.quoteId,
        paymentReference,
        payer,
        amountMicro: quote.amountMicro,
        nonce: quote.nonce,
        requestHash: quote.requestHash,
      }) ?? "";
    const funded = await verifyAndFundQuote({
      quoteId: quote.quoteId,
      paymentReference,
      payer,
      amountMicro: quote.amountMicro,
      currency: quote.currency,
      network: quote.network,
      recipient: quote.recipient,
      nonce: quote.nonce,
      idempotencyKey: `idem_${quote.quoteId}`,
      paymentSignature,
    });
    assert.equal(funded.ok, true);
    assert.equal(funded.quote?.paymentStatus, "verified");
    assert.equal(funded.quote?.lifecycleStatus, "funded");
  });

  await test("3. already-funded verified quote allows /fund without a second signature", async () => {
    const quote = await fundedQuoteFixture();
    const task = baseTask({ input: { repoUrl: "https://github.com/repodiet/demo-slop-app", quoteId: quote.quoteId } });
    const result = await validateVerifiedQuoteForA2aFund({
      task,
      quote,
      expectedQuoteId: quote.quoteId,
      expectedPaymentReference: quote.paymentReference,
      expectedPayer: quote.payer,
    });
    assert.equal(result.ok, true);
    assert.ok(result.payment);
  });

  await test("4. repeated /fund lock is idempotent", async () => {
    const taskId = `task_idem_${Date.now()}`;
    const first = await claimA2aFundLock({
      taskId,
      quoteId: "quote_idem",
      paymentReference: "0xabc",
      fundedAt: new Date().toISOString(),
    });
    assert.ok(first.lockToken);
    const marked = await markA2aFundExecutionQueued(taskId, first.lockToken!, {
      quoteId: "quote_idem",
      paymentReference: "0xabc",
    });
    assert.equal(marked, true);
    const second = await claimA2aFundLock({
      taskId,
      quoteId: "quote_idem",
      paymentReference: "0xabc",
      fundedAt: new Date().toISOString(),
    });
    assert.equal(first.claimed, true);
    assert.equal(second.claimed, false);
    const lock = await getA2aFundLock(taskId);
    assert.equal(lock?.executionQueued, true);
  });

  await test("5. concurrent /fund lock claims only once", async () => {
    const taskId = `task_conc_${Date.now()}`;
    const input = {
      taskId,
      quoteId: "quote_conc",
      paymentReference: "0xdef",
      fundedAt: new Date().toISOString(),
    };
    const results = await Promise.all([
      claimA2aFundLock(input),
      claimA2aFundLock(input),
      claimA2aFundLock(input),
    ]);
    assert.equal(results.filter((r) => r.claimed).length, 1);
  });

  await test("5b. lock TTL expires and token-gated release works", async () => {
    const taskId = `task_ttl_${Date.now()}`;
    const claimed = await claimA2aFundLock({
      taskId,
      quoteId: "quote_ttl",
      paymentReference: "0xttl",
      fundedAt: new Date().toISOString(),
    });
    assert.equal(claimed.claimed, true);
    const lock = await getA2aFundLock(taskId);
    assert.ok(lock);
    const expired = { ...lock!, expiresAt: new Date(Date.now() - 1000).toISOString() };
    assert.equal(isA2aFundLockExpired(expired), true);
    const released = await releaseA2aFundLockIfToken(taskId, lock!.lockToken);
    assert.equal(released, true);
    const reclaimed = await claimA2aFundLock({
      taskId,
      quoteId: "quote_ttl",
      paymentReference: "0xttl",
      fundedAt: new Date().toISOString(),
    });
    assert.equal(reclaimed.claimed, true);
    assert.ok(A2A_FUND_LOCK_TTL_MS > 0);
  });

  await test("6. quote/order mismatch is rejected", async () => {
    const quote = await fundedQuoteFixture();
    const task = baseTask({ input: { repoUrl: "https://github.com/repodiet/demo-slop-app", quoteId: quote.quoteId } });
    const result = await validateVerifiedQuoteForA2aFund({
      task,
      quote,
      order: {
        orderId: "okx_order_x",
        serviceId: "verified_cleanup_pr",
        serviceType: "A2A",
        repository: "repodiet/demo-slop-app",
        branch: "main",
        commitSha: "abc",
        status: "awaiting_payment",
        quoteId: "quote_other",
        a2aTaskId: task.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      expectedQuoteId: quote.quoteId,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "order_quote_mismatch");
  });

  await test("7. wrong payer is rejected", async () => {
    const quote = await fundedQuoteFixture();
    const task = baseTask({ input: { repoUrl: "https://github.com/repodiet/demo-slop-app", quoteId: quote.quoteId } });
    const result = await validateVerifiedQuoteForA2aFund({
      task,
      quote,
      expectedQuoteId: quote.quoteId,
      expectedPayer: "0xdead000000000000000000000000000000000000",
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "payer_mismatch");
  });

  await test("8. wrong recipient is rejected", async () => {
    const quote = await fundedQuoteFixture({ recipient: "0xdead000000000000000000000000000000000001" });
    const task = baseTask({ input: { repoUrl: "https://github.com/repodiet/demo-slop-app", quoteId: quote.quoteId } });
    const result = await validateVerifiedQuoteForA2aFund({ task, quote, expectedQuoteId: quote.quoteId });
    assert.equal(result.ok, false);
    assert.equal(result.code, "recipient_mismatch");
  });

  await test("9. wrong amount is rejected", async () => {
    const quote = await fundedQuoteFixture();
    const task = baseTask({ input: { repoUrl: "https://github.com/repodiet/demo-slop-app", quoteId: quote.quoteId } });
    const payment = await import("../src/lib/payment/payment-store").then((m) =>
      m.getPaymentByQuoteId(quote.quoteId)
    );
    assert.ok(payment);
    await savePaymentRecord({ ...payment!, amountMicro: "1" });
    const result = await validateVerifiedQuoteForA2aFund({ task, quote, expectedQuoteId: quote.quoteId });
    assert.equal(result.ok, false);
    assert.equal(result.code, "amount_mismatch");
  });

  await test("10. wrong network or asset is rejected", async () => {
    const networkQuote = await fundedQuoteFixture({ network: "eip155:1" });
    const networkTask = baseTask({
      input: { repoUrl: "https://github.com/repodiet/demo-slop-app", quoteId: networkQuote.quoteId },
    });
    const networkResult = await validateVerifiedQuoteForA2aFund({
      task: networkTask,
      quote: networkQuote,
      expectedQuoteId: networkQuote.quoteId,
    });
    assert.equal(networkResult.code, "network_mismatch");

    const assetQuote = await fundedQuoteFixture({ asset: "0x0000000000000000000000000000000000000001" });
    const assetTask = baseTask({
      input: { repoUrl: "https://github.com/repodiet/demo-slop-app", quoteId: assetQuote.quoteId },
    });
    const assetResult = await validateVerifiedQuoteForA2aFund({
      task: assetTask,
      quote: assetQuote,
      expectedQuoteId: assetQuote.quoteId,
    });
    assert.equal(assetResult.code, "asset_mismatch");
  });

  await test("11. funded quote cannot be reused for another task", async () => {
    const quote = await fundedQuoteFixture({ a2aTaskId: "task_other" });
    const task = baseTask({ id: "task_test_fund", input: { repoUrl: "https://github.com/repodiet/demo-slop-app", quoteId: quote.quoteId } });
    const result = await validateVerifiedQuoteForA2aFund({ task, quote, expectedQuoteId: quote.quoteId });
    assert.equal(result.ok, false);
    assert.equal(result.code, "quote_consumed");
  });

  await test("12. payment_failed task can recover using its original funded quote", async () => {
    const quote = await fundedQuoteFixture(undefined, { legacy: true });
    const hydrated = await hydrateVerifiedQuoteFromPayment(quote);
    assert.equal(hydrated.quote.paymentStatus, "verified");
    const task = baseTask({
      status: "payment_failed",
      input: { repoUrl: "https://github.com/repodiet/demo-slop-app", quoteId: quote.quoteId },
    });
    assert.ok(A2A_FUNDABLE_STATUSES.has("payment_failed"));
    const result = await validateVerifiedQuoteForA2aFund({
      task,
      quote: hydrated.quote,
      expectedQuoteId: quote.quoteId,
      expectedPaymentReference: quote.paymentReference,
      expectedPayer: quote.payer,
    });
    assert.equal(result.ok, true);
  });

  await test("12b. consumed quote with verified payment recovers for same task payment", async () => {
    const quote = await fundedQuoteFixture({ status: "consumed", taskId: "task_other" });
    const payment = await getPaymentByQuoteId(quote.quoteId);
    assert.ok(payment);
    const task = baseTask({
      id: "task_test_fund",
      status: "payment_failed",
      input: { repoUrl: "https://github.com/repodiet/demo-slop-app", quoteId: quote.quoteId },
    });
    const result = await validateVerifiedQuoteForA2aFund({
      task,
      quote,
      expectedQuoteId: quote.quoteId,
      expectedPaymentReference: quote.paymentReference,
      expectedPayer: quote.payer,
    });
    assert.equal(result.ok, true);
  });

  await withEnv("REPODIET_A2A_TEST_PRICE", undefined, async () => {
    await test("13. repository.verified_cleanup maps to verified_cleanup_pr pricing", async () => {
      assert.equal(mapTaskTypeToOperation("repository.verified_cleanup"), "verified_cleanup_pr");
      assert.notEqual(mapTaskTypeToOperation("repository.verified_cleanup"), "quick_cleanup");
      const price = resolveCommercePrice("verified_cleanup_pr", { sourceFileCount: 100 });
      assert.equal(price.amountMicro, "1000000");
    });
  });

  await withEnv("ALLOW_INTERNAL_TEST_BUYER", "1", async () => {
    await withEnv("REPODIET_A2A_TEST_PRICE", "1", async () => {
    await test("14. REPODIET_A2A_TEST_PRICE=0.20 applies to cleanup-PR test", async () => {
      const price = resolveCommercePrice("verified_cleanup_pr", { sourceFileCount: 100 });
      assert.equal(price.amountMicro, "200000");
      assert.equal(price.priceLabel, "0.20 USDT");
    });

    await withEnv("REQUIRE_REAL_X402", "1", async () => {
      await test("16. A2A test price settles without live x402 signature", async () => {
        const quote = await createBoundQuote({
          repository: "velz-cmd/Meridian",
          branch: "main",
          commitSha: "abc",
          findingIds: ["f1"],
          operation: "verified_cleanup_pr",
          transformedSourceHashes: { "src/example.ts": "sha256:test-preflight" },
        });
        const payer = "0xaa895234c3fc31c40018eef975db6ac79bf87f1a";
        const paymentReference = `0xtest_${quote.quoteId}`;
        const funded = await verifyAndFundQuote({
          quoteId: quote.quoteId,
          paymentReference,
          payer,
          amountMicro: quote.amountMicro,
          currency: quote.currency,
          network: quote.network,
          recipient: quote.recipient,
          nonce: quote.nonce,
          idempotencyKey: `idem_${quote.quoteId}`,
        });
        assert.equal(funded.ok, true, funded.reason);
        assert.equal(funded.quote?.paymentStatus, "verified");
      });
    });
    });
  });

  await withEnv("REPODIET_A2MCP_TEST_PRICE", undefined, async () => {
    await withEnv("REPODIET_A2MCP_TEST_PRICE_MICRO", undefined, async () => {
      await test("15. existing A2MCP x402 behavior remains unchanged", async () => {
        const price = getAnalyzeRepositoryPrice();
        assert.equal(price.amountMicro, "30000");
        assert.equal(priceForOperation("analyze_repository").amountMicro, "30000");
        assert.equal(X402_CURRENCY, "USDT");
        assert.ok(isQuoteVerified);
      });
    });
  });

  console.log("All a2a-funding tests passed.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
