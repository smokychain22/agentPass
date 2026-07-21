/** Deterministic production x402 contract tests. No network calls or funds. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "repodiet-a2mcp-x402-"));
process.env.REPODIET_DATA_DIR = dataDir;
process.env.REPODIET_PAYMENT_MODE = "mainnet";
process.env.REPODIET_PAYMENT_NETWORK = "eip155:196";
process.env.REPODIET_PAYMENT_ASSET = "0x779ded0c9e1022225f8e0630b35a9b54be713736";

import type { CommerceBinding } from "../src/lib/okx/types";
import type { BoundQuote } from "../src/lib/payment/types";
import {
  A2mcpX402Error,
  decodePaymentSignatureHeader,
  paymentRequirementsFromQuote,
  validatePaymentPayloadForRequest,
  verifyAndSettleA2mcpPayment,
  type X402Broker,
  type X402PaymentPayloadV2,
} from "../src/lib/payment/a2mcp-x402-production";
import { generateKeyPairSync } from "node:crypto";
import { MAINNET_NETWORK, MAINNET_USDT } from "../src/lib/payment/payment-environment";
import { paymentRequiredBody } from "../src/lib/payment/x402";
import {
  decodePaymentRequiredHeader,
  paymentRequiredJsonResponse,
} from "../src/lib/payment/x402-payment-required";

const RESOURCE = "https://skillswap-virid-kappa.vercel.app/api/a2mcp/quick-triage";
const SELLER = "0x1339724ada3adf04bb7a8ccc6498216214bbdf90";
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
    requestHash: "request-digest-1",
    resourceUrl: RESOURCE,
    requestMethod: "POST",
    requestPayloadHash: "payload-digest-1",
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
    requestHash: "commercial-digest-1",
    bindingHash: "binding-digest-1",
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

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

class Broker implements X402Broker {
  verifyCalls = 0;
  settleCalls = 0;
  valid = true;
  settleSuccess = true;

  async verify() {
    this.verifyCalls += 1;
    return this.valid ? { isValid: true, payer: BUYER } : { isValid: false, invalidMessage: "SECRET_SIGNATURE" };
  }

  async settle() {
    this.settleCalls += 1;
    return this.settleSuccess
      ? { success: true, status: "success", payer: BUYER, transaction: `0x${"ab".repeat(32)}`, network: MAINNET_NETWORK }
      : { success: false, status: "failed", errorMessage: "SECRET_SIGNATURE" };
  }
}

async function expectCode(work: () => unknown | Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(
    async () => await work(),
    (error: unknown) => error instanceof A2mcpX402Error && error.code === code
  );
}

async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  console.log(`  ✓ ${name}`);
}

async function main() {
  console.log("a2mcp-real-production-e2e");

  await test("canonical unpaid response is HTTP 402 with decodable nonempty accepts[]", () => {
    const response = paymentRequiredJsonResponse(paymentRequiredBody(RESOURCE, "30000"));
    assert.equal(response.status, 402);
    const header = response.headers.get("PAYMENT-REQUIRED");
    assert.ok(header);
    const decoded = decodePaymentRequiredHeader(header);
    assert.equal(decoded.x402Version, 2);
    assert.equal(decoded.resource.url, RESOURCE);
    assert.equal(decoded.accepts.length, 1);
  });

  await test("production requirements are exact X Layer mainnet USD₮0 terms", () => {
    const requirements = paymentRequirementsFromQuote(quote("q_terms"));
    assert.deepEqual(
      { scheme: requirements.scheme, network: requirements.network, asset: requirements.asset, amount: requirements.amount, payTo: requirements.payTo },
      { scheme: "exact", network: "eip155:196", asset: MAINNET_USDT, amount: "30000", payTo: SELLER }
    );
  });

  await test("PAYMENT-SIGNATURE base64 and base64url decoding round trips", () => {
    const value = payload(quote("q_decode"));
    const encoded = Buffer.from(JSON.stringify(value)).toString("base64url");
    assert.deepEqual(decodePaymentSignatureHeader(encoded), value);
  });

  const validationCases: Array<[string, (p: X402PaymentPayloadV2) => void, string]> = [
    ["wrong amount", (p) => { p.accepted.amount = "1"; }, "PAYMENT_MISMATCH"],
    ["wrong asset", (p) => { p.accepted.asset = `0x${"2".repeat(40)}`; }, "PAYMENT_MISMATCH"],
    ["wrong network", (p) => { p.accepted.network = "eip155:1952"; }, "PAYMENT_MISMATCH"],
    ["wrong recipient", (p) => { p.accepted.payTo = `0x${"3".repeat(40)}`; }, "PAYMENT_MISMATCH"],
    ["expired authorization", (p) => { p.payload.authorization.validBefore = String(now - 1); }, "EXPIRED_AUTHORIZATION"],
    ["resource mismatch", (p) => { p.resource.url = `${RESOURCE}/other`; }, "PAYMENT_MISMATCH"],
  ];
  for (const [name, mutate, code] of validationCases) {
    await test(`${name} is rejected before broker verification`, async () => {
      const b = binding();
      const q = quote(`q_${name.replaceAll(" ", "_")}`, b);
      const p = payload(q, String(validationCases.indexOf(validationCases.find((c) => c[0] === name)!) + 2));
      mutate(p);
      await expectCode(() => Promise.resolve(validatePaymentPayloadForRequest({ payload: p, quote: q, binding: b, nowSeconds: now })), code);
    });
  }

  await test("changed payload digest is rejected", async () => {
    const b = binding();
    const q = quote("q_payload", b);
    await expectCode(
      () => Promise.resolve(validatePaymentPayloadForRequest({ payload: payload(q, "8"), quote: q, binding: binding({ requestPayloadHash: "changed" }), nowSeconds: now })),
      "REQUEST_MISMATCH"
    );
  });

  await test("invalid signature never settles and upstream detail is not exposed", async () => {
    const b = binding({ requestHash: "invalid-signature-request" });
    const q = quote("q_invalid_signature", b);
    const broker = new Broker();
    broker.valid = false;
    await assert.rejects(
      () => verifyAndSettleA2mcpPayment({ payload: payload(q, "9"), quote: q, binding: b, broker, nowSeconds: now }),
      (error: unknown) => error instanceof A2mcpX402Error && error.code === "INVALID_PAYMENT" && !error.message.includes("SECRET_SIGNATURE")
    );
    assert.equal(broker.settleCalls, 0);
  });

  await test("settlement failure never produces settlement evidence", async () => {
    const b = binding({ requestHash: "settlement-failure-request" });
    const q = quote("q_settlement_failure", b);
    const broker = new Broker();
    broker.settleSuccess = false;
    await expectCode(
      () => verifyAndSettleA2mcpPayment({ payload: payload(q, "a"), quote: q, binding: b, broker, nowSeconds: now }),
      "SETTLEMENT_FAILED"
    );
    assert.equal(broker.verifyCalls, 1);
    assert.equal(broker.settleCalls, 1);
  });

  await test("valid payment verifies and settles once; identical replay does neither again", async () => {
    const b = binding({ requestHash: "successful-request" });
    const q = quote("q_success", b);
    const p = payload(q, "b");
    const broker = new Broker();
    const first = await verifyAndSettleA2mcpPayment({ payload: p, quote: q, binding: b, broker, nowSeconds: now });
    const replay = await verifyAndSettleA2mcpPayment({ payload: p, quote: q, binding: b, broker, nowSeconds: now });
    assert.equal(first.transaction, replay.transaction);
    assert.ok(first.paymentResponseHeader);
    assert.equal(broker.verifyCalls, 1);
    assert.equal(broker.settleCalls, 1);
    const alteredProof = clone(p);
    alteredProof.payload.signature = `0x${"34".repeat(65)}`;
    await expectCode(
      () => verifyAndSettleA2mcpPayment({ payload: alteredProof, quote: q, binding: b, broker, nowSeconds: now }),
      "REPLAYED_AUTHORIZATION"
    );
    assert.equal(broker.settleCalls, 1);
  });

  await test("settled nonce cannot authorize a second quote", async () => {
    const b = binding({ requestHash: "nonce-request" });
    const q1 = quote("q_nonce_one", b);
    const q2 = quote("q_nonce_two", b);
    const broker = new Broker();
    await verifyAndSettleA2mcpPayment({ payload: payload(q1, "c"), quote: q1, binding: b, broker, nowSeconds: now });
    await expectCode(
      () => verifyAndSettleA2mcpPayment({ payload: payload(q2, "c"), quote: q2, binding: b, broker, nowSeconds: now }),
      "REPLAYED_AUTHORIZATION"
    );
    assert.equal(broker.settleCalls, 1);
  });

  await test("paid result receipt is signed and binds the resolved commit", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.REPODIET_OPERATOR_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const { signOkxReceipt } = await import("../src/lib/okx/payment-provider");
    const { verifyExecutionReceiptV1 } = await import("../src/lib/operator/sign-receipt");
    const receipt = await signOkxReceipt({
      serviceId: "analyze_repository",
      serviceType: "A2MCP",
      taskId: "task_receipt",
      requestHash: "commercial-digest",
      quoteRequestDigest: "commercial-digest",
      executionRequestDigest: "execution-digest",
      result: { findings: [{ id: "unused-export" }], commitSha: COMMIT },
      quoteId: "q_receipt",
      paymentReference: `0x${"ef".repeat(32)}`,
      buyer: BUYER,
      seller: SELLER,
      amountMicro: "30000",
      token: MAINNET_USDT,
      network: MAINNET_NETWORK,
      operation: "analyze_repository",
      repository: "velz-cmd/repodiet-e2e-test",
      commitSha: COMMIT,
    });
    assert.ok(receipt.signature);
    assert.equal(receipt.commitSha, COMMIT);
    assert.equal(receipt.signedReceipt?.commitSha, COMMIT);
    assert.ok(
      verifyExecutionReceiptV1(
        receipt.signedReceipt as never,
        receipt.signature!,
        publicKey.export({ type: "spki", format: "pem" }).toString()
      )
    );
    delete process.env.REPODIET_OPERATOR_PRIVATE_KEY;
  });

  await test("public payment artifacts contain no credentials or payment signature", () => {
    const q = quote("q_no_secrets");
    const publicJson = JSON.stringify({ challenge: paymentRequiredBody(RESOURCE, "30000"), requirements: paymentRequirementsFromQuote(q) });
    for (const forbidden of ["OKX_API_KEY", "OKX_SECRET_KEY", "OKX_PASSPHRASE", payload(q, "d").payload.signature]) {
      assert.ok(!publicJson.includes(forbidden));
    }
  });

  console.log("a2mcp-real-production-e2e: all passed");
}

main()
  .finally(() => fs.rmSync(dataDir, { recursive: true, force: true }))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
