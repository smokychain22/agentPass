/**
 * OKX AI Agent Marketplace User Agreement §7.7 (Sampling as a condition of
 * listing) fixture tests. Sampling is detected ONLY from the authenticated
 * facilitator settlement response (SettleData.sampling), never from caller
 * request bodies, query parameters, or headers. No network calls, no funds.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "repodiet-a2mcp-sampling-"));
process.env.REPODIET_DATA_DIR = dataDir;
process.env.REPODIET_PAYMENT_MODE = "mainnet";
process.env.REPODIET_PAYMENT_NETWORK = "eip155:196";
process.env.REPODIET_PAYMENT_ASSET = "0x779ded0c9e1022225f8e0630b35a9b54be713736";

import type { CommerceBinding } from "../src/lib/okx/types";
import type { BoundQuote } from "../src/lib/payment/types";
import {
  A2mcpX402Error,
  isX402SamplingResult,
  verifyAndSettleA2mcpPayment,
  type SettleData,
  type VerifyData,
  type X402Broker,
  type X402PaymentPayloadV2,
} from "../src/lib/payment/a2mcp-x402-production";
import { MAINNET_NETWORK, MAINNET_USDT } from "../src/lib/payment/payment-environment";

const RESOURCE = "https://skillswap-virid-kappa.vercel.app/api/a2mcp/quick-triage";
const SELLER = "0xaa895234c3fc31c40018eef975db6ac79bf87f1a";
const BUYER = "0x1111111111111111111111111111111111111111";
const COMMIT = "a".repeat(40);
const now = Math.floor(Date.now() / 1000);

function binding(overrides: Partial<CommerceBinding> = {}): CommerceBinding {
  return {
    repository: "velz-cmd/repodiet-e2e-test",
    branch: "main",
    commitSha: COMMIT,
    findingIds: [],
    operation: "analyze_repository",
    requestHash: "sampling-request-digest",
    resourceUrl: RESOURCE,
    requestMethod: "POST",
    requestPayloadHash: "sampling-payload-digest",
    ...overrides,
  };
}

function quote(id: string, b = binding(), overrides: Partial<BoundQuote> = {}): BoundQuote {
  return {
    quoteId: id,
    operation: "analyze_repository",
    repository: b.repository,
    branch: b.branch,
    commitSha: b.commitSha,
    findingIds: [],
    verificationProfile: "standard",
    amount: "0.03",
    amountMicro: "30000",
    currency: "USDT",
    network: MAINNET_NETWORK,
    recipient: SELLER,
    asset: MAINNET_USDT,
    nonce: "challenge-nonce",
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    requestHash: "sampling-commercial-digest",
    bindingHash: "sampling-binding-digest",
    executionRequestHash: b.requestHash,
    resourceUrl: b.resourceUrl,
    requestMethod: b.requestMethod,
    requestPayloadHash: b.requestPayloadHash,
    priceLabel: "0.03 USD₮0",
    status: "payment_required",
    lifecycleStatus: "quote_created",
    createdAt: new Date().toISOString(),
    environment: "mainnet",
    paymentMode: "mainnet",
    chainId: 196,
    ...overrides,
  };
}

function payload(q: BoundQuote, nonceSeed = "1"): X402PaymentPayloadV2 {
  return {
    x402Version: 2,
    resource: { url: RESOURCE, description: "RepoDiet triage", mimeType: "application/json" },
    accepted: {
      scheme: "exact",
      network: MAINNET_NETWORK,
      asset: MAINNET_USDT,
      amount: "30000",
      payTo: SELLER,
      maxTimeoutSeconds: 300,
      extra: { name: "USD₮0", version: "1", quoteId: q.quoteId },
    },
    payload: {
      signature: `0x${"12".repeat(65)}`,
      authorization: {
        from: BUYER,
        to: SELLER,
        value: "30000",
        validAfter: String(now - 2),
        validBefore: String(now + 240),
        nonce: `0x${nonceSeed.repeat(64).slice(0, 64)}`,
      },
    },
  };
}

/** Fake facilitator whose settle() response is fully controlled per test case — this is the ONLY place "sampling" ever originates from, simulating the authenticated OKX facilitator boundary. */
class FakeFacilitator implements X402Broker {
  settleCalls = 0;
  verifyCalls = 0;
  settleResponse: SettleData;
  verifyResponse: VerifyData = { isValid: true, payer: BUYER };

  constructor(settleResponse: SettleData) {
    this.settleResponse = settleResponse;
  }

  async verify(): Promise<VerifyData> {
    this.verifyCalls += 1;
    return this.verifyResponse;
  }

  async settle(): Promise<SettleData> {
    this.settleCalls += 1;
    return this.settleResponse;
  }
}

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  console.log(`  ✓ ${name}`);
}

async function main() {
  console.log("a2mcp-sampling");

  await test("authenticated sampling:true — no reject on unsettled payment, bounded result, no revenue fields", async () => {
    const b = binding({ requestHash: "sampling-true-request" });
    const q = quote("q_sampling_true", b);
    const facilitator = new FakeFacilitator({ sampling: true, success: false });
    const result = await verifyAndSettleA2mcpPayment({
      payload: payload(q, "1"),
      quote: q,
      binding: b,
      broker: facilitator,
      nowSeconds: now,
    });
    assert.equal(isX402SamplingResult(result), true);
    assert.ok(!("transaction" in result));
    assert.ok(!("paymentResponseHeader" in result));
    assert.equal(facilitator.settleCalls, 1);
  });

  await test("authenticated sampling:false behaves as a normal (failed, since unsettled) settlement", async () => {
    const b = binding({ requestHash: "sampling-false-request" });
    const q = quote("q_sampling_false", b);
    const facilitator = new FakeFacilitator({ sampling: false, success: false, status: "failed", errorMessage: "not settled" });
    await assert.rejects(
      () =>
        verifyAndSettleA2mcpPayment({
          payload: payload(q, "2"),
          quote: q,
          binding: b,
          broker: facilitator,
          nowSeconds: now,
        }),
      (error: unknown) => error instanceof A2mcpX402Error
    );
  });

  await test("missing sampling field behaves as a normal settlement (rejected when unsettled)", async () => {
    const b = binding({ requestHash: "sampling-missing-request" });
    const q = quote("q_sampling_missing", b);
    const facilitator = new FakeFacilitator({ success: false, status: "failed", errorMessage: "not settled" });
    await assert.rejects(
      () =>
        verifyAndSettleA2mcpPayment({
          payload: payload(q, "3"),
          quote: q,
          binding: b,
          broker: facilitator,
          nowSeconds: now,
        }),
      (error: unknown) => error instanceof A2mcpX402Error
    );
  });

  await test("spoofed request-body sampling:true does not exist as an input — the function accepts no such field and cannot be influenced by it", async () => {
    const b = binding({ requestHash: "sampling-spoof-request" });
    const q = quote("q_sampling_spoof", b);
    // A caller-controlled payload has no field that could carry "sampling" into
    // verifyAndSettleA2mcpPayment — its only inputs are payload/quote/binding,
    // none of which are echoed into SettleData. Attaching an arbitrary property
    // to the payload object (as a hostile caller might attempt) must have zero
    // effect: the facilitator response alone decides.
    const spoofedPayload = { ...payload(q, "4"), sampling: true } as unknown as X402PaymentPayloadV2;
    const facilitator = new FakeFacilitator({ success: false, status: "failed", errorMessage: "not settled" });
    await assert.rejects(
      () =>
        verifyAndSettleA2mcpPayment({
          payload: spoofedPayload,
          quote: q,
          binding: b,
          broker: facilitator,
          nowSeconds: now,
        }),
      (error: unknown) => error instanceof A2mcpX402Error
    );
  });

  await test("paid normal request is not misclassified as sampling", async () => {
    const b = binding({ requestHash: "sampling-paid-request" });
    const q = quote("q_sampling_paid", b);
    const facilitator = new FakeFacilitator({
      success: true,
      status: "success",
      payer: BUYER,
      transaction: `0x${"ab".repeat(32)}`,
      network: MAINNET_NETWORK,
    });
    const result = await verifyAndSettleA2mcpPayment({
      payload: payload(q, "5"),
      quote: q,
      binding: b,
      broker: facilitator,
      nowSeconds: now,
    });
    assert.equal(isX402SamplingResult(result), false);
    if (!isX402SamplingResult(result)) {
      assert.ok(result.paymentResponseHeader);
      assert.equal(result.transaction, `0x${"ab".repeat(32)}`);
    }
  });

  await test("malformed settlement response (sampling present but wrong type) is not treated as authenticated sampling", async () => {
    const b = binding({ requestHash: "sampling-malformed-request" });
    const q = quote("q_sampling_malformed", b);
    const facilitator = new FakeFacilitator({
      success: false,
      status: "failed",
      // @ts-expect-error deliberately malformed for the fixture
      sampling: "true",
    });
    await assert.rejects(
      () =>
        verifyAndSettleA2mcpPayment({
          payload: payload(q, "6"),
          quote: q,
          binding: b,
          broker: facilitator,
          nowSeconds: now,
        }),
      (error: unknown) => error instanceof A2mcpX402Error
    );
  });

  await test("duplicate sampling request (identical payload/quote/binding) replays the cached result, no second facilitator call, no revenue", async () => {
    const b = binding({ requestHash: "sampling-duplicate-request" });
    const q = quote("q_sampling_duplicate", b);
    const p = payload(q, "7");
    const facilitator = new FakeFacilitator({ sampling: true, success: false });
    const first = await verifyAndSettleA2mcpPayment({
      payload: p,
      quote: q,
      binding: b,
      broker: facilitator,
      nowSeconds: now,
    });
    assert.equal(isX402SamplingResult(first), true);
    assert.equal(facilitator.settleCalls, 1);

    const replay = await verifyAndSettleA2mcpPayment({
      payload: p,
      quote: q,
      binding: b,
      broker: facilitator,
      nowSeconds: now,
    });
    assert.equal(isX402SamplingResult(replay), true);
    // No second facilitator call — the identical sampling result was served from the durable cache.
    assert.equal(facilitator.settleCalls, 1);

    // A *mismatched* replay (same authorization, different request binding) is rejected, not
    // silently reused — caught either by the binding-consistency check or REPLAYED_AUTHORIZATION,
    // depending on which validation runs first; either way, never returns the cached sampling result.
    const mismatched = binding({ requestHash: "sampling-different-request" });
    await assert.rejects(
      () =>
        verifyAndSettleA2mcpPayment({
          payload: p,
          quote: q,
          binding: mismatched,
          broker: facilitator,
          nowSeconds: now,
        }),
      (error: unknown) => error instanceof A2mcpX402Error
    );
  });

  console.log("a2mcp-sampling: all passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
