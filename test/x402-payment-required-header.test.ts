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

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      console.error(`  ✗ ${name}`);
      throw err;
    }
  })();
}

console.log("x402-payment-required-header");

async function main() {
  const resourceUrl = canonicalResourceUrl(
    "/api/a2mcp/quick-triage",
    "http://localhost:3000/api/a2mcp/quick-triage"
  );
  process.env.NEXT_PUBLIC_APP_URL = "https://skillswap-skillswap7.vercel.app";

  const canonicalUrl = canonicalResourceUrl("/api/a2mcp/quick-triage");
  assert.equal(canonicalUrl, "https://skillswap-skillswap7.vercel.app/api/a2mcp/quick-triage");

  const body = {
    success: false,
    paymentRequired: true,
    ...paymentRequiredBody(resourceUrl, "30000", "quote_test123"),
  };

  await test("builds challenge matching body fields", () => {
    const challenge = buildX402ChallengeFrom402Body(body);
    assert.equal(challenge.x402Version, 2);
    assert.equal(challenge.scheme, "exact");
    assert.equal(challenge.network, X402_NETWORK);
    assert.equal(challenge.asset, X402_ASSET);
    assert.equal(challenge.amount, "30000");
    assert.equal(challenge.payTo, X402_RECIPIENT);
    assert.equal(challenge.resource.url, resourceUrl);
    assert.equal(challenge.maxTimeoutSeconds, 300);
    assert.equal(challenge.extra?.quoteId, "quote_test123");
  });

  await test("header is valid base64 and decodes to challenge", () => {
    const challenge = buildX402ChallengeFrom402Body(body);
    const encoded = encodePaymentRequiredHeader(challenge);
    assert.match(encoded, /^[A-Za-z0-9+/=]+$/);
    const decoded = decodePaymentRequiredHeader(encoded);
    assert.deepEqual(decoded, challenge);
  });

  await test("paymentRequiredJsonResponse includes PAYMENT-REQUIRED header", () => {
    const res = paymentRequiredJsonResponse(body, 402);
    assert.equal(res.status, 402);
    const header = res.headers.get("PAYMENT-REQUIRED");
    assert.ok(header, "PAYMENT-REQUIRED header must exist");
    assert.equal(res.headers.get("Access-Control-Expose-Headers"), "PAYMENT-REQUIRED");
    const decoded = decodePaymentRequiredHeader(header!);
    const challenge = buildX402ChallengeFrom402Body(body);
    assert.deepEqual(decoded, challenge);
  });

  await test("canonical production URL is used when configured", () => {
    const configured = canonicalResourceUrl("/api/a2mcp/quick-triage");
    assert.equal(configured, "https://skillswap-skillswap7.vercel.app/api/a2mcp/quick-triage");
    const challenge = buildX402ChallengeFrom402Body({
      ...body,
      resource: { url: configured, mimeType: "application/json" },
    });
    assert.equal(challenge.resource.url, "https://skillswap-skillswap7.vercel.app/api/a2mcp/quick-triage");
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
