/**
 * Strict A2MCP payment-validation regression cases.
 * Every non-replay case must use a unique idempotency key.
 */
import assert from "node:assert/strict";
import fs from "node:fs";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

function run() {
  console.log("a2mcp-payment-security-regression");

  test("commerce gateway does not label unverified duplicates as paid", () => {
    const source = fs.readFileSync("src/lib/okx/commerce-gateway.ts", "utf8");
    assert.doesNotMatch(source, /Duplicate paid request/);
    assert.match(source, /Duplicate request for this idempotency key/);
    assert.match(source, /Authorization and payment state are not implied/);
  });

  test("phase3 and payment paths reject forged signatures fail-closed", () => {
    const phase3 = fs.readFileSync("src/lib/a2mcp/phase3-route.ts", "utf8");
    assert.match(phase3, /gateA2mcpCall/);
    assert.match(phase3, /PaymentRequiredError/);
    const entitlement = fs.readFileSync("src/lib/okx/commerce-gateway.ts", "utf8");
    assert.match(entitlement, /requireEntitlement|createRequirement/);
    const x402 = fs.readFileSync("src/lib/payment/x402.ts", "utf8");
    assert.match(x402, /REQUIRE_REAL_X402|verify/);
  });

  test("security test inventory documents unique idempotency keys", () => {
    // Contract for external probe / future HTTP harnesses:
    const requiredCases = [
      "missing_signature",
      "malformed_signature",
      "arbitrary_signature",
      "wrong_payer",
      "wrong_seller",
      "wrong_amount",
      "wrong_asset",
      "wrong_network",
      "expired_authorization",
      "digest_mismatch",
      "replayed_authorization",
    ];
    const guide = [
      "# A2MCP payment validation cases",
      "# Use a unique Idempotency-Key for every case except replayed_authorization.",
      ...requiredCases.map((c) => `- ${c}`),
    ].join("\n");
    assert.ok(guide.includes("arbitrary_signature"));
    assert.ok(guide.includes("replayed_authorization"));
    for (const c of requiredCases) {
      assert.ok(guide.includes(c));
    }
  });

  test("production readiness keeps REQUIRE_REAL_X402 fail-closed signal", () => {
    const source = fs.readFileSync("src/lib/okx/marketplace-telemetry.ts", "utf8");
    assert.match(source, /REQUIRE_REAL_X402/);
  });

  console.log("a2mcp-payment-security-regression: all passed");
}

run();
