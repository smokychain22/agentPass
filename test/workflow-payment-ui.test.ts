import assert from "node:assert/strict";
import {
  createTestPaymentReference,
  isTrustedTestQuote,
  normalizeWalletAddress,
} from "../src/lib/workflow/payment-ui";
import { REPODIET_OWNER_BUYER_WALLET } from "../src/lib/wallet/owner-buyer-wallet";
import type { WorkflowQuote } from "../src/lib/workflow/client";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

test("trusted test quote is detected from settlement mode", () => {
  const quote = { priceLabel: "1.00 USDT", settlementMode: "trusted_test" } as WorkflowQuote;
  assert.equal(isTrustedTestQuote(quote), true);
});

test("a price label alone can never enable test payment", () => {
  const quote = { priceLabel: "0.20 USDT" } as WorkflowQuote;
  assert.equal(isTrustedTestQuote(quote), false);
});

test("payment reference is a valid 0x hash", () => {
  const ref = createTestPaymentReference("quote_abc123");
  assert.match(ref, /^0x[a-fA-F0-9]{40}$/);
});

test("wallet normalization accepts valid payer", () => {
  const wallet = normalizeWalletAddress("0xaa895234c3fc31c40018eef975db6ac79bf87f1a");
  assert.equal(wallet, "0xaa895234c3fc31c40018eef975db6ac79bf87f1a");
});

test("owner buyer wallet is the OKX email-generated payer", () => {
  assert.equal(REPODIET_OWNER_BUYER_WALLET, "0xaa895234c3fc31c40018eef975db6ac79bf87f1a");
});

test("wallet normalization rejects seller pasted as reference", () => {
  assert.throws(() => normalizeWalletAddress("0x1339724ada3adf04bb7a8ccc6498216214bbdf90 seller"));
});

console.log("workflow-payment-ui: all passed");
