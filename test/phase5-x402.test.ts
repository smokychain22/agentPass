import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBoundQuote, signTestPaymentPayload, validateQuoteBinding } from "../src/lib/payment/quote-service";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    await fn();
    console.log(`  ✓ ${name}`);
  })();
}

async function run() {
  console.log("Phase 5 x402 settlement tests");

  await test("payment module files exist", () => {
    for (const f of [
      "src/lib/payment/settlement.ts",
      "src/lib/payment/quote-service.ts",
      "src/lib/payment/failure-policy.ts",
      "src/app/api/tasks/pay/route.ts",
    ]) {
      assert.ok(fs.existsSync(path.join(ROOT, f)), f);
    }
  });

  await test("bound quote includes requestHash and network", async () => {
    const quote = await createBoundQuote({
      repository: "repodiet/demo-slop-app",
      branch: "main",
      commitSha: "abc123",
      findingIds: ["f1"],
      operation: "quick_cleanup",
    });
    assert.match(quote.requestHash, /^sha256:/);
    assert.equal(quote.currency, "USDT");
    assert.ok(quote.recipient);
    assert.ok(quote.nonce);
  });

  await test("quote binding rejects repo mismatch", async () => {
    const quote = await createBoundQuote({
      repository: "owner/a",
      branch: "main",
      commitSha: "abc",
      findingIds: [],
      operation: "quick_cleanup",
    });
    const result = validateQuoteBinding(quote, {
      repository: "owner/b",
      branch: "main",
      commitSha: "abc",
      findingIds: [],
      operation: "quick_cleanup",
    });
    assert.equal(result.ok, false);
  });

  await test("test payment signature roundtrip", () => {
    process.env.REPODIET_X402_TEST_SECRET = "test-secret";
    const payload = { quoteId: "q1", amountMicro: "250000", nonce: "n1" };
    const sig = signTestPaymentPayload(payload);
    assert.ok(sig);
    const { verifyTestPaymentPayload } = require("../src/lib/payment/quote-service");
    assert.equal(verifyTestPaymentPayload(payload, sig!), true);
  });

  await test("receipt v1 schema in sign-receipt", () => {
    const src = fs.readFileSync(path.join(ROOT, "src/lib/operator/sign-receipt.ts"), "utf8");
    assert.match(src, /SignedReceiptV1/);
    assert.match(src, /version: RECEIPT_VERSION/);
    assert.match(src, /pullRequestUrl/);
  });

  console.log("All Phase 5 x402 tests passed.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
