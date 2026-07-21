import assert from "node:assert/strict";
import { paymentRequiredBody } from "../src/lib/payment/x402";
import { X402_ASSET, X402_NETWORK, X402_RECIPIENT } from "../src/lib/payment/constants";
import {
  assertCanonicalX402Challenge,
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

  await test("PAYMENT-REQUIRED decodes to canonical x402 v2 with accepts[]", () => {
    const challenge = buildX402ChallengeFrom402Body(body);
    assertCanonicalX402Challenge(challenge);
    assert.equal(challenge.x402Version, 2);
    assert.ok(challenge.resource?.url);
    assert.equal(challenge.resource.mimeType, "application/json");
    assert.ok(Array.isArray(challenge.accepts) && challenge.accepts.length >= 1);
    assert.equal(challenge.accepts[0].scheme, "exact");
    assert.equal(challenge.accepts[0].network, X402_NETWORK);
    assert.equal(challenge.accepts[0].asset, X402_ASSET);
    assert.equal(challenge.accepts[0].amount, "30000");
    assert.equal(challenge.accepts[0].payTo, X402_RECIPIENT);
    assert.equal(challenge.accepts[0].maxTimeoutSeconds, 300);
    assert.equal(challenge.accepts[0].extra?.quoteId, "quote_test123");
    // Must NOT flatten payment fields to the top level.
    assert.equal((challenge as Record<string, unknown>).scheme, undefined);
    assert.equal((challenge as Record<string, unknown>).network, undefined);
    assert.equal((challenge as Record<string, unknown>).asset, undefined);
    assert.equal((challenge as Record<string, unknown>).amount, undefined);
    assert.equal((challenge as Record<string, unknown>).payTo, undefined);
  });

  await test("header is valid base64 and decodes to challenge", () => {
    const challenge = buildX402ChallengeFrom402Body(body);
    const encoded = encodePaymentRequiredHeader(challenge);
    assert.match(encoded, /^[A-Za-z0-9+/=]+$/);
    const decoded = decodePaymentRequiredHeader(encoded);
    assert.deepEqual(decoded, challenge);
    assert.ok(Array.isArray(decoded.accepts) && decoded.accepts.length >= 1);
  });

  await test("header and body use the same canonical challenge", async () => {
    const res = paymentRequiredJsonResponse(body, 402);
    assert.equal(res.status, 402);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
    const header = res.headers.get("PAYMENT-REQUIRED");
    assert.ok(header, "PAYMENT-REQUIRED header must exist");
    assert.equal(res.headers.get("Access-Control-Expose-Headers"), "PAYMENT-REQUIRED");
    const decoded = decodePaymentRequiredHeader(header!);
    const payload = (await res.json()) as Record<string, unknown>;
    assert.equal(payload.x402Version, decoded.x402Version);
    assert.deepEqual(payload.resource, decoded.resource);
    assert.deepEqual(payload.accepts, decoded.accepts);
  });

  await test("preserves every advertised accepts entry", () => {
    const multi = {
      ...body,
      accepts: [
        ...(body.accepts as unknown[]),
        {
          scheme: "exact",
          network: "eip155:1952",
          asset: "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c",
          amount: "30000",
          payTo: X402_RECIPIENT,
          maxTimeoutSeconds: 300,
          extra: { name: "USD₮0", version: "1", lane: "testnet" },
        },
      ],
    };
    const challenge = buildX402ChallengeFrom402Body(multi);
    assert.equal(challenge.accepts.length, 2);
    assert.equal(challenge.accepts[1].network, "eip155:1952");
    assert.equal(challenge.accepts[1].extra?.lane, "testnet");
  });

  await test("rejects empty accepts", () => {
    assert.throws(
      () => buildX402ChallengeFrom402Body({ ...body, accepts: [] }),
      /nonempty accepts/
    );
  });

  await test("canonical production URL is used when configured", () => {
    const configured = canonicalResourceUrl("/api/a2mcp/quick-triage");
    assert.equal(configured, "https://skillswap-skillswap7.vercel.app/api/a2mcp/quick-triage");
    const challenge = buildX402ChallengeFrom402Body({
      ...body,
      resource: {
        url: configured,
        description: "RepoDiet A2MCP Quick Triage",
        mimeType: "application/json",
      },
    });
    assert.equal(challenge.resource.url, "https://skillswap-skillswap7.vercel.app/api/a2mcp/quick-triage");
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
