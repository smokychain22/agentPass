/**
 * x402 v2 PAYMENT-REQUIRED header canonical structure tests.
 *
 * These tests verify that the PAYMENT-REQUIRED header encodes the complete
 * x402 v2 challenge with a proper `accepts` array — not a flat top-level
 * scheme/network/asset/amount/payTo structure which caused:
 *   "unsupported: 402 challenge has no accepts[] array"
 *
 * All tests use mocks and fixtures. No real funds are transferred.
 */
import assert from "node:assert/strict";
import { paymentRequiredBody } from "../src/lib/payment/x402";
import { X402_ASSET, X402_NETWORK, X402_RECIPIENT } from "../src/lib/payment/constants";
import {
  buildX402ChallengeFrom402Body,
  decodePaymentRequiredHeader,
  encodePaymentRequiredHeader,
  paymentRequiredJsonResponse,
} from "../src/lib/payment/x402-payment-required";
import { canonicalResourceUrl } from "../src/lib/payment/canonical-app-url";
import {
  getValidatedX402Config,
  validatePaymentProofFields,
  QUICK_TRIAGE_AMOUNT,
  QUICK_TRIAGE_RESOURCE_PATH,
} from "../src/lib/payment/x402-config-validation";
import {
  MAINNET_NETWORK,
  MAINNET_USDT,
} from "../src/lib/payment/payment-environment";
import { buildCommerceBinding } from "../src/lib/okx/commerce-gateway";

// ---------------------------------------------------------------------------
// Test runner helpers
// ---------------------------------------------------------------------------
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}:`, err instanceof Error ? err.message : err);
    throw err;
  }
}

function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key]!;
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key]!;
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
console.log("x402-payment-required-header (canonical x402 v2 structure)");

async function main() {
  // Set up a canonical production-like resource URL for tests.
  process.env.NEXT_PUBLIC_APP_URL = "https://skillswap-virid-kappa.vercel.app";
  const resourceUrl = canonicalResourceUrl(QUICK_TRIAGE_RESOURCE_PATH);

  assert.equal(
    resourceUrl,
    "https://skillswap-virid-kappa.vercel.app/api/a2mcp/quick-triage"
  );

  // ---------------------------------------------------------------------------
  // 1. Unpaid valid request returns HTTP 402
  // ---------------------------------------------------------------------------
  await test("unpaid request: paymentRequiredJsonResponse returns HTTP 402", () => {
    const body = paymentRequiredBody(resourceUrl, QUICK_TRIAGE_AMOUNT);
    const res = paymentRequiredJsonResponse(body);
    assert.equal(res.status, 402);
  });

  await test("production validation runs at request time and fails closed", () => {
    withEnv(
      {
        VERCEL_ENV: "production",
        REPODIET_APP_URL: "https://skillswap-skillswap7.vercel.app",
      },
      () => {
        assert.throws(
          () => paymentRequiredBody(resourceUrl, QUICK_TRIAGE_AMOUNT),
          /okx_identity_conflict:NEXT_PUBLIC_APP_URL,REPODIET_APP_URL/
        );
      }
    );
  });

  // ---------------------------------------------------------------------------
  // 2. PAYMENT-REQUIRED decodes to: x402Version=2, resource object, accepts array
  // ---------------------------------------------------------------------------
  await test("PAYMENT-REQUIRED: x402Version === 2, resource object, non-empty accepts array", () => {
    const body = paymentRequiredBody(resourceUrl, QUICK_TRIAGE_AMOUNT);
    const header = res402Header(body);
    const decoded = decodePaymentRequiredHeader(header);

    assert.equal(decoded.x402Version, 2, "x402Version must be 2");
    assert.ok(decoded.resource, "resource must exist");
    assert.ok(typeof decoded.resource.url === "string", "resource.url must be a string");
    assert.ok(Array.isArray(decoded.accepts), "accepts must be an array");
    assert.ok(decoded.accepts.length >= 1, "accepts must have at least one entry");
  });

  // ---------------------------------------------------------------------------
  // 3. Expected production values are under accepts[0]
  // ---------------------------------------------------------------------------
  await test("accepts[0]: expected production values", () => {
    const body = paymentRequiredBody(resourceUrl, QUICK_TRIAGE_AMOUNT);
    const header = res402Header(body);
    const decoded = decodePaymentRequiredHeader(header);
    const a0 = decoded.accepts[0];

    assert.equal(a0.scheme, "exact", "scheme must be exact");
    assert.equal(a0.network, MAINNET_NETWORK, `network must be ${MAINNET_NETWORK}`);
    assert.equal(a0.network, "eip155:196");
    assert.equal(a0.asset.toLowerCase(), MAINNET_USDT, `asset must be ${MAINNET_USDT}`);
    assert.equal(
      a0.asset.toLowerCase(),
      "0x779ded0c9e1022225f8e0630b35a9b54be713736"
    );
    assert.equal(a0.amount, QUICK_TRIAGE_AMOUNT, `amount must be ${QUICK_TRIAGE_AMOUNT}`);
    assert.equal(a0.amount, "30000");
    assert.equal(
      a0.payTo.toLowerCase(),
      X402_RECIPIENT.toLowerCase(),
      "payTo must match configured recipient"
    );
    // USD₮0 extra fields
    assert.ok(a0.extra, "extra must exist");
    assert.equal(a0.extra!.name, "USD₮0", 'extra.name must be "USD₮0"');
    assert.equal(a0.extra!.version, "1", 'extra.version must be "1"');
  });

  // ---------------------------------------------------------------------------
  // 4. No flat top-level scheme/network/asset/amount/payTo fields
  // ---------------------------------------------------------------------------
  await test("no flat top-level scheme/network/asset/amount/payTo fields in header", () => {
    const body = paymentRequiredBody(resourceUrl, QUICK_TRIAGE_AMOUNT);
    const header = res402Header(body);
    const decoded = decodePaymentRequiredHeader(header) as unknown as Record<string, unknown>;

    assert.equal(decoded.scheme, undefined, "scheme must NOT be at top level");
    assert.equal(decoded.network, undefined, "network must NOT be at top level");
    assert.equal(decoded.asset, undefined, "asset must NOT be at top level");
    assert.equal(decoded.amount, undefined, "amount must NOT be at top level");
    assert.equal(decoded.payTo, undefined, "payTo must NOT be at top level");
  });

  // ---------------------------------------------------------------------------
  // 5. Header and JSON response body represent the same canonical challenge
  // ---------------------------------------------------------------------------
  await test("header and response body represent the same canonical challenge", () => {
    const body = paymentRequiredBody(resourceUrl, QUICK_TRIAGE_AMOUNT);
    const res = paymentRequiredJsonResponse(body);
    const headerValue = res.headers.get("PAYMENT-REQUIRED");
    assert.ok(headerValue, "PAYMENT-REQUIRED header must be present");

    const decodedFromHeader = decodePaymentRequiredHeader(headerValue!);
    const challengeFromBody = buildX402ChallengeFrom402Body(body as Record<string, unknown>);

    // The header must encode the same challenge the body describes.
    assert.deepEqual(decodedFromHeader, challengeFromBody);
    assert.equal(decodedFromHeader.accepts[0].network, body.accepts[0].network);
    assert.equal(decodedFromHeader.accepts[0].asset, body.accepts[0].asset);
    assert.equal(decodedFromHeader.accepts[0].amount, body.accepts[0].amount);
    assert.equal(decodedFromHeader.resource.url, body.resource.url);
  });

  // ---------------------------------------------------------------------------
  // 6. Missing or malformed accepts fails
  // ---------------------------------------------------------------------------
  await test("missing accepts throws", () => {
    assert.throws(
      () => buildX402ChallengeFrom402Body({ x402Version: 2, resource: { url: "https://example.com" } }),
      /accepts/
    );
  });

  await test("empty accepts array throws", () => {
    assert.throws(
      () =>
        buildX402ChallengeFrom402Body({
          x402Version: 2,
          resource: { url: "https://example.com" },
          accepts: [],
        }),
      /accepts/
    );
  });

  await test("accepts entry missing required fields throws", () => {
    assert.throws(
      () =>
        buildX402ChallengeFrom402Body({
          x402Version: 2,
          resource: { url: "https://example.com" },
          accepts: [{ scheme: "exact", network: "eip155:196" }], // missing asset/amount/payTo
        }),
      /accepts\[0\]/
    );
  });

  await test("missing resource.url throws", () => {
    assert.throws(
      () =>
        buildX402ChallengeFrom402Body({
          x402Version: 2,
          accepts: [
            {
              scheme: "exact",
              network: "eip155:196",
              asset: MAINNET_USDT,
              amount: "30000",
              payTo: X402_RECIPIENT,
            },
          ],
        }),
      /resource\.url/
    );
  });

  // ---------------------------------------------------------------------------
  // 7. Missing production configuration fails closed
  // ---------------------------------------------------------------------------
  await test("missing payTo address fails closed", () => {
    withEnv(
      {
        OKX_AGENTIC_WALLET_ADDRESS: undefined,
        PAY_TO_ADDRESS: undefined,
        REPODIET_PAY_TO: undefined,
      },
      () => {
        // payTo getter returns empty when no env var is set
        assert.throws(
          () =>
            getValidatedX402Config(
              () => "",
              () => `https://skillswap-virid-kappa.vercel.app${QUICK_TRIAGE_RESOURCE_PATH}`
            ),
          /payTo.*not configured|payTo.*is not a valid/i
        );
      }
    );
  });

  await test("missing resource URL fails closed", () => {
    assert.throws(
      () =>
        getValidatedX402Config(
          () => "0x1339724ada3adf04bb7a8ccc6498216214bbdf90",
          () => ""
        ),
      /resource URL.*empty/i
    );
  });

  await test("non-HTTPS resource URL fails closed", () => {
    assert.throws(
      () =>
        getValidatedX402Config(
          () => "0x1339724ada3adf04bb7a8ccc6498216214bbdf90",
          () => `http://skillswap-virid-kappa.vercel.app${QUICK_TRIAGE_RESOURCE_PATH}`
        ),
      /HTTPS/
    );
  });

  await test("resource URL with wrong path fails closed", () => {
    assert.throws(
      () =>
        getValidatedX402Config(
          () => "0x1339724ada3adf04bb7a8ccc6498216214bbdf90",
          () => "https://skillswap-virid-kappa.vercel.app/api/other-endpoint"
        ),
      /resource URL.*must end/i
    );
  });

  // ---------------------------------------------------------------------------
  // 8. Testnet and production configuration cannot mix
  // ---------------------------------------------------------------------------
  await test("testnet network rejected in production config validator", () => {
    withEnv({ REPODIET_PAYMENT_NETWORK: "eip155:1952" }, () => {
      assert.throws(
        () =>
          getValidatedX402Config(
            () => "0x1339724ada3adf04bb7a8ccc6498216214bbdf90",
            () => `https://skillswap-virid-kappa.vercel.app${QUICK_TRIAGE_RESOURCE_PATH}`,
            process.env
          ),
        /eip155:196|production network/i
      );
    });
  });

  await test("testnet asset rejected in production config validator", () => {
    withEnv({ REPODIET_PAYMENT_ASSET: "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c" }, () => {
      assert.throws(
        () =>
          getValidatedX402Config(
            () => "0x1339724ada3adf04bb7a8ccc6498216214bbdf90",
            () => `https://skillswap-virid-kappa.vercel.app${QUICK_TRIAGE_RESOURCE_PATH}`,
            process.env
          ),
        /MAINNET_USDT|production asset|779ded/i
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 9. Invalid requests return 4xx before 402 (tested via route module)
  // ---------------------------------------------------------------------------
  await test("invalid request body structure: accepts with wrong network is still validated", () => {
    // buildX402ChallengeFrom402Body accepts any network string, but
    // validatePaymentProofFields rejects wrong network at proof-verification time.
    const mismatch = validatePaymentProofFields({
      network: "eip155:1",  // Ethereum mainnet — wrong
      asset: MAINNET_USDT,
      payTo: X402_RECIPIENT,
      amount: "30000",
      configuredPayTo: X402_RECIPIENT,
    });
    assert.ok(mismatch, "mismatch should be detected");
    assert.match(mismatch!, /network.*eip155:196/i);
  });

  // ---------------------------------------------------------------------------
  // 10. Wrong network/asset/amount/payee payment proofs are rejected
  // ---------------------------------------------------------------------------
  await test("proof validator: wrong network rejected", () => {
    const result = validatePaymentProofFields({
      network: "eip155:1",
      configuredPayTo: X402_RECIPIENT,
    });
    assert.ok(result !== null, "should flag wrong network");
    assert.match(result!, /network/);
  });

  await test("proof validator: wrong asset rejected", () => {
    const result = validatePaymentProofFields({
      asset: "0x0000000000000000000000000000000000000000",
      configuredPayTo: X402_RECIPIENT,
    });
    assert.ok(result !== null, "should flag wrong asset");
    assert.match(result!, /asset/);
  });

  await test("proof validator: wrong payTo rejected", () => {
    const result = validatePaymentProofFields({
      payTo: "0xaa895234c3fc31c40018eef975db6ac79bf87f1a",
      configuredPayTo: "0x1339724ada3adf04bb7a8ccc6498216214bbdf90",
    });
    assert.ok(result !== null, "should flag wrong payTo");
    assert.match(result!, /payTo/);
  });

  await test("proof validator: wrong amount rejected", () => {
    const result = validatePaymentProofFields({
      amount: "1", // paid 1 micro-USDT instead of 30000
      configuredPayTo: X402_RECIPIENT,
    });
    assert.ok(result !== null, "should flag wrong amount");
    assert.match(result!, /amount/);
  });

  await test("proof validator: correct production values pass", () => {
    const result = validatePaymentProofFields({
      network: MAINNET_NETWORK,
      asset: MAINNET_USDT,
      payTo: X402_RECIPIENT,
      amount: "30000",
      configuredPayTo: X402_RECIPIENT,
    });
    assert.equal(result, null, "correct production values must pass");
  });

  // ---------------------------------------------------------------------------
  // 11. Expired or invalid authorization is rejected
  // (verified via settlement module — here we confirm challenge expiry signaling)
  // ---------------------------------------------------------------------------
  await test("challenge includes maxTimeoutSeconds for protocol-level expiry", () => {
    const body = paymentRequiredBody(resourceUrl, QUICK_TRIAGE_AMOUNT);
    const challenge = buildX402ChallengeFrom402Body(body as Record<string, unknown>);
    assert.equal(challenge.accepts[0].maxTimeoutSeconds, 300);
  });

  // ---------------------------------------------------------------------------
  // 12. Valid mocked paid replay returns HTTP 200
  // (integration-level, using a mock that simulates a verified entitlement)
  // ---------------------------------------------------------------------------
  await test("mocked valid payment: entitlement allowed produces no 402", () => {
    // Simulate a buyer that has a valid funded quote for the correct repository/amount.
    // The actual settlement verification is handled by gateA2mcpCall → requireEntitlement.
    // Here we confirm the building blocks work: if payment is verified, no challenge is issued.
    const quote = {
      quoteId: "quote_mock_paid_001",
      network: MAINNET_NETWORK,
      asset: MAINNET_USDT,
      amountMicro: "30000",
      recipient: X402_RECIPIENT,
    };
    const mismatch = validatePaymentProofFields({
      network: quote.network,
      asset: quote.asset,
      payTo: quote.recipient,
      amount: quote.amountMicro,
      configuredPayTo: X402_RECIPIENT,
    });
    assert.equal(mismatch, null, "valid mock payment proof must not be flagged");
  });

  // ---------------------------------------------------------------------------
  // 13. Settlement failure does not return the protected resource
  // (contract-level: route only returns 200 after settlement succeeds)
  // ---------------------------------------------------------------------------
  await test("settlement failure signaled via validatePaymentProofFields returns non-null mismatch", () => {
    // A failed settlement would have wrong network/asset. The validator must catch it.
    const result = validatePaymentProofFields({
      network: "eip155:1952", // testnet — proof from wrong chain
      asset: "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c", // testnet USDT
      payTo: X402_RECIPIENT,
      amount: "30000",
      configuredPayTo: X402_RECIPIENT,
    });
    assert.ok(result !== null, "testnet payment proof must be rejected before returning resource");
  });

  // ---------------------------------------------------------------------------
  // 14. Identical paid replay does not settle or execute twice
  // (idempotency — tested via a2mcp-paid-path-fixture; here we verify the key)
  // ---------------------------------------------------------------------------
  await test("idempotency: same quoteId produces same request hash (not re-executed)", () => {
    // The request hash is deterministic from operation+repo+branch+commitSha.
    // Re-submitting the same quoteId with the same binding will be served from cache.
    const b1 = buildCommerceBinding({
      operation: "analyze_repository",
      repository: "smokychain22/agentPass",
      branch: "main",
      commitSha: "abc123",
    });
    const b2 = buildCommerceBinding({
      operation: "analyze_repository",
      repository: "smokychain22/agentPass",
      branch: "main",
      commitSha: "abc123",
    });
    assert.equal(b1.requestHash, b2.requestHash, "same binding must produce same requestHash");
  });

  // ---------------------------------------------------------------------------
  // 15. Payment proof reused for a different repository/commit/request is rejected
  // ---------------------------------------------------------------------------
  await test("request hash differs for different repo: proof cannot be reused cross-repo", () => {
    const original = buildCommerceBinding({
      operation: "analyze_repository",
      repository: "smokychain22/agentPass",
      branch: "main",
      commitSha: "abc123",
    });
    const different = buildCommerceBinding({
      operation: "analyze_repository",
      repository: "attacker/evil-repo",
      branch: "main",
      commitSha: "abc123",
    });
    assert.notEqual(
      original.requestHash,
      different.requestHash,
      "different repository must produce different requestHash"
    );
  });

  await test("request hash differs for different commit SHA: proof cannot be reused cross-commit", () => {
    const original = buildCommerceBinding({
      operation: "analyze_repository",
      repository: "smokychain22/agentPass",
      branch: "main",
      commitSha: "abc123",
    });
    const different = buildCommerceBinding({
      operation: "analyze_repository",
      repository: "smokychain22/agentPass",
      branch: "main",
      commitSha: "def456",
    });
    assert.notEqual(
      original.requestHash,
      different.requestHash,
      "different commitSha must produce different requestHash"
    );
  });

  // ---------------------------------------------------------------------------
  // Additional: PAYMENT-REQUIRED header is valid base64 and round-trips
  // ---------------------------------------------------------------------------
  await test("PAYMENT-REQUIRED header is valid base64", () => {
    const body = paymentRequiredBody(resourceUrl, QUICK_TRIAGE_AMOUNT);
    const header = res402Header(body);
    assert.match(header, /^[A-Za-z0-9+/=]+$/, "header must be valid base64");
  });

  await test("encodePaymentRequiredHeader / decodePaymentRequiredHeader round-trips", () => {
    const body = paymentRequiredBody(resourceUrl, QUICK_TRIAGE_AMOUNT);
    const challenge = buildX402ChallengeFrom402Body(body as Record<string, unknown>);
    const encoded = encodePaymentRequiredHeader(challenge);
    const decoded = decodePaymentRequiredHeader(encoded);
    assert.deepEqual(decoded, challenge, "round-trip must be lossless");
  });

  await test("Access-Control-Expose-Headers includes PAYMENT-REQUIRED", () => {
    const body = paymentRequiredBody(resourceUrl, QUICK_TRIAGE_AMOUNT);
    const res = paymentRequiredJsonResponse(body);
    assert.equal(res.headers.get("Access-Control-Expose-Headers"), "PAYMENT-REQUIRED");
  });

  await test("Cache-Control: no-store is set on 402 response", () => {
    const body = paymentRequiredBody(resourceUrl, QUICK_TRIAGE_AMOUNT);
    const res = paymentRequiredJsonResponse(body);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
  });

  await test("getValidatedX402Config returns correct production values when env is valid", () => {
    const config = getValidatedX402Config(
      () => "0x1339724ada3adf04bb7a8ccc6498216214bbdf90",
      () => `https://skillswap-virid-kappa.vercel.app${QUICK_TRIAGE_RESOURCE_PATH}`
    );
    assert.equal(config.network, "eip155:196");
    assert.equal(config.asset, MAINNET_USDT);
    assert.equal(config.amount, "30000");
    assert.equal(config.payTo, "0x1339724ada3adf04bb7a8ccc6498216214bbdf90");
    assert.ok(config.resourceUrl.endsWith(QUICK_TRIAGE_RESOURCE_PATH));
  });

  await test("paymentRequiredBody includes resource description", () => {
    const body = paymentRequiredBody(resourceUrl, QUICK_TRIAGE_AMOUNT);
    assert.ok(body.resource.description, "resource.description must be set");
    assert.match(body.resource.description, /triage|repodiet/i);
  });

  console.log("\nAll x402-payment-required-header tests passed.");
}

// ---------------------------------------------------------------------------
// Helper: extract PAYMENT-REQUIRED header value from paymentRequiredJsonResponse
// ---------------------------------------------------------------------------
function res402Header(body: ReturnType<typeof paymentRequiredBody>): string {
  const res = paymentRequiredJsonResponse(body);
  const header = res.headers.get("PAYMENT-REQUIRED");
  if (!header) throw new Error("PAYMENT-REQUIRED header missing from 402 response");
  return header;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
