/** Verify-only diagnostic tests. No network calls, signatures, or funds. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "repodiet-verify-only-"));
process.env.REPODIET_DATA_DIR = dataDir;
process.env.REPODIET_PAYMENT_MODE = "mainnet";
process.env.REPODIET_PAYMENT_NETWORK = "eip155:196";
process.env.REPODIET_PAYMENT_ASSET = "0x779ded0c9e1022225f8e0630b35a9b54be713736";

import { resolveBindingFromBody } from "../src/lib/okx/a2mcp-adapter";
import {
  createOkxX402VerifyOnlyClient,
  paymentRequirementsFromQuote,
  type FacilitatorDiagnostic,
  type X402PaymentPayloadV2,
  type X402VerifyOnlyClient,
} from "../src/lib/payment/a2mcp-x402-production";
import {
  getVerifyDiagnosticAttemptForTest,
  runVerifyOnlyDiagnostic,
  VerifyOnlyDiagnosticError,
  type VerifyOnlyDiagnosticRequest,
  type VerifyOnlyDiagnosticResponse,
} from "../src/lib/payment/a2mcp-verify-only-diagnostic";
import { createVerifyOnlyDiagnosticRoute } from "../src/lib/payment/a2mcp-verify-only-route";
import { saveBoundQuote } from "../src/lib/payment/payment-store";
import type { BoundQuote } from "../src/lib/payment/types";

const RESOURCE = "https://skillswap-virid-kappa.vercel.app/api/a2mcp/quick-triage";
const SELLER = "0x1339724ada3adf04bb7a8ccc6498216214bbdf90";
const BUYER = "0x1111111111111111111111111111111111111111";
const ASSET = "0x779ded0c9e1022225f8e0630b35a9b54be713736";
const COMMIT = "a".repeat(40);
const TOKEN = "diagnostic-secret-with-at-least-32-characters";

function originalRequest(maximumFindings = 3) {
  return {
    operation: "analyze_repository",
    repositoryUrl: "https://github.com/velz-cmd/repodiet-e2e-test",
    branch: "main",
    maximumFindings,
  };
}

function forwardedRequest(maximumFindings = 3) {
  return {
    repoUrl: originalRequest().repositoryUrl,
    repositoryUrl: originalRequest().repositoryUrl,
    branch: "main",
    commitSha: COMMIT,
    maximumFindings,
    source: "quick_triage",
    operation: "analyze_repository",
    quoteId: undefined,
    paymentReference: undefined,
    payer: undefined,
    idempotencyKey: undefined,
  };
}

async function newQuote(id: string): Promise<BoundQuote> {
  const binding = await resolveBindingFromBody(forwardedRequest(), "analyze_repository", {
    url: RESOURCE,
    method: "POST",
  });
  const quote: BoundQuote = {
    quoteId: id,
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
    recipient: SELLER,
    asset: ASSET,
    nonce: `challenge-${id}`,
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    requestHash: binding.requestHash,
    bindingHash: `binding-${id}`,
    executionRequestHash: binding.requestHash,
    resourceUrl: binding.resourceUrl,
    requestMethod: binding.requestMethod,
    requestPayloadHash: binding.requestPayloadHash,
    priceLabel: "0.03 USD₮0",
    status: "payment_required",
    lifecycleStatus: "quote_created",
    createdAt: new Date().toISOString(),
    environment: "mainnet",
    paymentMode: "mainnet",
    chainId: 196,
  };
  await saveBoundQuote(quote);
  return quote;
}

function payload(quote: BoundQuote, nonceSeed: string, overrides: Partial<X402PaymentPayloadV2> = {}): X402PaymentPayloadV2 {
  const now = Math.floor(Date.now() / 1000);
  const value: X402PaymentPayloadV2 = {
    x402Version: 2,
    resource: { url: RESOURCE, description: "RepoDiet triage", mimeType: "application/json" },
    accepted: {
      scheme: "exact",
      network: "eip155:196",
      asset: ASSET,
      amount: "30000",
      payTo: SELLER,
      maxTimeoutSeconds: 300,
      extra: { name: "USD₮0", version: "1", quoteId: quote.quoteId },
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
  return { ...value, ...overrides };
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function diagnostic(httpStatus = 200, overrides: Partial<FacilitatorDiagnostic> = {}): FacilitatorDiagnostic {
  return {
    event: "repodiet.x402.facilitator",
    phase: "verify",
    correlationId: "corr_safe",
    paymentAttemptId: "attempt_safe",
    timestamp: new Date().toISOString(),
    path: "/api/v6/pay/x402/verify",
    httpStatus,
    okxCode: httpStatus === 200 ? "0" : "FACILITATOR_REJECTED",
    okxMessage: httpStatus === 200 ? "" : "Authorization rejected",
    isValid: httpStatus === 200,
    invalidReason: httpStatus === 200 ? null : "invalid_signature",
    invalidMessage: httpStatus === 200 ? null : "Authorization rejected",
    recipient: "0x133972...bbdf90",
    payer: "0x111111...111111",
    ...overrides,
  };
}

class VerifyClient implements X402VerifyOnlyClient {
  verifyCalls = 0;
  settleCalls = 0;
  statusCalls = 0;
  constructor(private readonly responseStatus = 200, private readonly leakText?: string) {}
  async verify() {
    this.verifyCalls += 1;
    return {
      data: this.responseStatus === 200 ? { isValid: true, payer: BUYER } : { isValid: false },
      diagnostic: diagnostic(this.responseStatus, this.leakText ? {
        okxMessage: this.leakText,
        invalidMessage: this.leakText,
      } : {}),
      internalCode: this.responseStatus === 200 ? "VERIFICATION_ACCEPTED" : "FACILITATOR_REJECTED",
    };
  }
  // Deliberately not part of X402VerifyOnlyClient. The zero counters prove a
  // maliciously over-capable injected object still cannot be asked to settle.
  async settle() { this.settleCalls += 1; }
  async settlementStatus() { this.statusCalls += 1; }
}

function requestFor(quote: BoundQuote, signaturePayload: X402PaymentPayloadV2, attemptId: string): VerifyOnlyDiagnosticRequest {
  return {
    attemptId,
    attemptCreatedAt: new Date().toISOString(),
    paymentSignature: encode(signaturePayload),
    originalRequest: originalRequest(),
    originalResourceUrl: RESOURCE,
    paymentRequirements: paymentRequirementsFromQuote(quote),
  };
}

async function expectCode(work: () => unknown | Promise<unknown>, code: string) {
  await assert.rejects(
    async () => await work(),
    (error: unknown) => error instanceof VerifyOnlyDiagnosticError && error.code === code
  );
}

async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  console.log(`  ✓ ${name}`);
}

async function main() {
  console.log("a2mcp-verify-only-diagnostic");

  await test("valid local payload calls verify exactly once and cannot settle or release product data", async () => {
    const quote = await newQuote("diag_quote_valid");
    const client = new VerifyClient();
    const result = await runVerifyOnlyDiagnostic({
      request: requestFor(quote, payload(quote, "1"), "diag_valid_attempt_0001"),
      client,
    });
    assert.equal(client.verifyCalls, 1);
    assert.equal(client.settleCalls, 0);
    assert.equal(client.statusCalls, 0);
    assert.equal(result.ok, true);
    assert.equal(result.settlementAttempted, false);
    assert.equal(result.findingsReleased, false);
    assert.equal(result.receiptCreated, false);
    assert.equal("findings" in result, false);
    assert.equal("receipt" in result, false);
    const stored = await getVerifyDiagnosticAttemptForTest("diag_valid_attempt_0001");
    assert.equal(stored?.consumed, true);
    assert.equal(stored?.verificationAttempted, true);
    assert.deepEqual(stored?.result, result);
    assert.equal("paymentSignature" in (stored ?? {}), false);
  });

  await test("production verify-only capability exposes one method and reaches only the official verify path", async () => {
    const quote = await newQuote("diag_quote_factory");
    const signed = payload(quote, "f");
    const urls: string[] = [];
    const client = createOkxX402VerifyOnlyClient({
      correlationId: "corr_factory",
      env: {
        NODE_ENV: "test",
        OKX_API_KEY: "test-api-key",
        OKX_SECRET_KEY: "test-secret-key",
        OKX_PASSPHRASE: "test-passphrase",
      },
      fetchImpl: async (url) => {
        urls.push(String(url));
        return new Response(JSON.stringify({ code: "0", msg: "", data: { isValid: true, payer: BUYER } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      diagnosticSink: () => undefined,
    });
    assert.deepEqual(Object.keys(client), ["verify"]);
    assert.equal("settle" in client, false);
    assert.equal("settlementStatus" in client, false);
    const result = await client.verify(signed, paymentRequirementsFromQuote(quote));
    assert.equal(result.data?.isValid, true);
    assert.deepEqual(urls, ["https://web3.okx.com/api/v6/pay/x402/verify"]);
  });

  await test("resource, body hash, and payment requirements mismatches fail before verify", async () => {
    const quote = await newQuote("diag_quote_mismatch");
    const base = requestFor(quote, payload(quote, "2"), "diag_mismatch_attempt_1");
    const resourceClient = new VerifyClient();
    await expectCode(
      () => runVerifyOnlyDiagnostic({ request: { ...base, originalResourceUrl: `${RESOURCE}/wrong` }, client: resourceClient }),
      "RESOURCE_MISMATCH"
    );
    assert.equal(resourceClient.verifyCalls, 0);

    const bodyClient = new VerifyClient();
    await expectCode(
      () => runVerifyOnlyDiagnostic({
        request: { ...base, attemptId: "diag_mismatch_attempt_2", originalRequest: originalRequest(4) },
        client: bodyClient,
      }),
      "REQUEST_MISMATCH"
    );
    assert.equal(bodyClient.verifyCalls, 0);

    const requirementsClient = new VerifyClient();
    await expectCode(
      () => runVerifyOnlyDiagnostic({
        request: {
          ...base,
          attemptId: "diag_mismatch_attempt_3",
          paymentRequirements: { ...base.paymentRequirements, amount: "1" },
        },
        client: requirementsClient,
      }),
      "PAYMENT_REQUIREMENTS_MISMATCH"
    );
    assert.equal(requirementsClient.verifyCalls, 0);
  });

  await test("stale attempt and expired authorization fail before verify", async () => {
    const quote = await newQuote("diag_quote_expired");
    const client = new VerifyClient();
    const stale = requestFor(quote, payload(quote, "3"), "diag_stale_attempt_0001");
    stale.attemptCreatedAt = new Date(Date.now() - 6 * 60_000).toISOString();
    await expectCode(() => runVerifyOnlyDiagnostic({ request: stale, client }), "EXPIRED_ATTEMPT");

    const expiredPayload = payload(quote, "4");
    const now = Math.floor(Date.now() / 1000);
    expiredPayload.payload.authorization.validAfter = String(now - 300);
    expiredPayload.payload.authorization.validBefore = String(now - 1);
    await expectCode(
      () => runVerifyOnlyDiagnostic({
        request: requestFor(quote, expiredPayload, "diag_expired_auth_0001"),
        client,
      }),
      "PAYMENT_AUTHORIZATION_EXPIRED"
    );
    assert.equal(client.verifyCalls, 0);
  });

  await test("attempt IDs and authorization fingerprints are single use", async () => {
    const quote = await newQuote("diag_quote_replay");
    const signed = payload(quote, "5");
    const client = new VerifyClient();
    const first = requestFor(quote, signed, "diag_single_use_attempt");
    await runVerifyOnlyDiagnostic({ request: first, client });
    await expectCode(() => runVerifyOnlyDiagnostic({ request: first, client }), "REUSED_DIAGNOSTIC_ATTEMPT");
    await expectCode(
      () => runVerifyOnlyDiagnostic({
        request: { ...first, attemptId: "diag_second_attempt_0001", attemptCreatedAt: new Date().toISOString() },
        client,
      }),
      "REUSED_AUTHORIZATION"
    );
    assert.equal(client.verifyCalls, 1);
  });

  await test("facilitator rejection returns only safe correlated fields", async () => {
    const quote = await newQuote("diag_quote_rejected");
    const signed = payload(quote, "6");
    const result = await runVerifyOnlyDiagnostic({
      request: requestFor(quote, signed, "diag_rejected_attempt_1"),
      client: new VerifyClient(400, "OKX_SECRET=super-sensitive-value"),
    });
    assert.equal(result.ok, false);
    assert.equal(result.verification.code, "FACILITATOR_REJECTED");
    assert.equal(result.verification.invalidReason, "invalid_signature");
    assert.match(result.verification.msg, /\[redacted\]/);
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(signed.payload.signature), false);
    assert.equal(serialized.includes(signed.payload.authorization.nonce), false);
    assert.equal(serialized.includes(TOKEN), false);
  });

  await test("route is hidden by default and rejects missing or wrong tokens generically", async () => {
    let calls = 0;
    const run = async () => { calls += 1; throw new Error("should not run"); };
    const disabled = createVerifyOnlyDiagnosticRoute({ env: { NODE_ENV: "test" }, run });
    const disabledResponse = await disabled(new Request("https://example.test/internal", { method: "POST" }));
    assert.equal(disabledResponse.status, 404);
    assert.deepEqual(await disabledResponse.json(), { ok: false, error: "Not found." });

    const enabled = createVerifyOnlyDiagnosticRoute({
      env: { NODE_ENV: "test", REPODIET_A2MCP_DIAGNOSTIC_ENABLED: "1", REPODIET_A2MCP_DIAGNOSTIC_TOKEN: TOKEN },
      run,
    });
    for (const supplied of [undefined, "wrong-token-that-is-long-enough-xxxxxxxx"]) {
      const response = await enabled(new Request("https://example.test/internal", {
        method: "POST",
        headers: supplied ? { "x-repodiet-diagnostic-token": supplied } : {},
      }));
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { ok: false, error: "Unauthorized." });
    }
    assert.equal(calls, 0);
  });

  await test("route rejects invalid JSON and oversized bodies and always disables caching", async () => {
    const route = createVerifyOnlyDiagnosticRoute({
      env: { NODE_ENV: "test", REPODIET_A2MCP_DIAGNOSTIC_ENABLED: "1", REPODIET_A2MCP_DIAGNOSTIC_TOKEN: TOKEN },
      run: async () => { throw new Error("should not run"); },
    });
    const invalid = await route(new Request("https://example.test/internal", {
      method: "POST",
      headers: { "content-type": "application/json", "x-repodiet-diagnostic-token": TOKEN },
      body: "{",
    }));
    assert.equal(invalid.status, 400);
    assert.equal(invalid.headers.get("cache-control"), "no-store");

    const oversized = await route(new Request("https://example.test/internal", {
      method: "POST",
      headers: { "content-type": "application/json", "x-repodiet-diagnostic-token": TOKEN },
      body: JSON.stringify({ value: "x".repeat(33 * 1024) }),
    }));
    assert.equal(oversized.status, 413);
  });

  await test("successful route response remains verify-only", async () => {
    const safeResult: VerifyOnlyDiagnosticResponse = {
      ok: true,
      correlationId: "corr_route",
      attemptId: "diag_route_attempt_0001",
      verification: { httpStatus: 200, code: "0", msg: "", isValid: true, invalidReason: null, invalidMessage: null },
      settlementAttempted: false,
      findingsReleased: false,
      receiptCreated: false,
    };
    let calls = 0;
    const route = createVerifyOnlyDiagnosticRoute({
      env: { NODE_ENV: "test", REPODIET_A2MCP_DIAGNOSTIC_ENABLED: "1", REPODIET_A2MCP_DIAGNOSTIC_TOKEN: TOKEN },
      run: async () => { calls += 1; return safeResult; },
    });
    const response = await route(new Request("https://example.test/internal", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-repodiet-diagnostic-token": TOKEN,
        "payment-signature": "opaque-not-logged",
      },
      body: JSON.stringify({
        attemptId: safeResult.attemptId,
        attemptCreatedAt: new Date().toISOString(),
        originalRequest: originalRequest(),
        originalResourceUrl: RESOURCE,
        paymentRequirements: {},
      }),
    }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(calls, 1);
    assert.deepEqual(await response.json(), safeResult);
  });

  await test("architectural boundary excludes settlement, analysis, findings, and receipt capabilities", () => {
    const root = path.resolve(process.cwd());
    const diagnosticSource = fs.readFileSync(path.join(root, "src/lib/payment/a2mcp-verify-only-diagnostic.ts"), "utf8");
    const routeSource = fs.readFileSync(path.join(root, "src/lib/payment/a2mcp-verify-only-route.ts"), "utf8");
    const routeEntrySource = fs.readFileSync(path.join(root, "src/app/api/internal/a2mcp/verify-diagnostic/route.ts"), "utf8");
    const combined = `${diagnosticSource}\n${routeSource}\n${routeEntrySource}`;
    for (const forbidden of [
      /\.settle\s*\(/,
      /settlementStatus\s*\(/,
      /verifyAndSettleA2mcpPayment/,
      /analyzeRepository/,
      /executeQuickTriage/,
      /createReceipt/,
      /signOkxReceipt/,
      /persistPaidResult/,
    ]) {
      assert.equal(forbidden.test(combined), false, `forbidden capability matched ${forbidden}`);
    }
    const securitySource = fs.readFileSync(path.join(root, "src/lib/payment/a2mcp-verify-only-route-security.ts"), "utf8");
    assert.match(securitySource, /timingSafeEqual/);
  });
}

main()
  .then(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
    console.log("a2mcp-verify-only-diagnostic: all assertions passed");
  })
  .catch((error) => {
    fs.rmSync(dataDir, { recursive: true, force: true });
    console.error(error);
    process.exitCode = 1;
  });
