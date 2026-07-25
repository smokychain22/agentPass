import assert from "node:assert/strict";
import test from "node:test";
import { isTransferTimestampWithinQuoteWindow } from "../src/lib/payment/onchain-usdt";
import { validateQuoteBinding } from "../src/lib/payment/quote-service";
import type { BoundQuote } from "../src/lib/payment/types";

const createdAt = "2026-07-25T20:22:01.976Z";
const expiresAt = "2026-07-25T20:37:01.975Z";

function quote(overrides: Partial<BoundQuote> = {}): BoundQuote {
  return {
    quoteId: "quote_late_payment",
    operation: "verified_cleanup_pr",
    repository: "velz-cmd/Meridian",
    branch: "main",
    commitSha: "a".repeat(40),
    findingIds: ["fnd_1"],
    verificationProfile: "standard",
    amount: "0.03",
    amountMicro: "30000",
    currency: "USDT",
    network: "eip155:196",
    recipient: "0x1339724ada3adf04bb7a8ccc6498216214bbdf90",
    asset: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
    nonce: "nonce",
    expiresAt,
    requestHash: "sha256:request",
    bindingHash: "sha256:binding",
    priceLabel: "0.03 USD₮0",
    status: "payment_required",
    lifecycleStatus: "payment_required",
    createdAt,
    ...overrides,
  };
}

function bindingContext(validationTimeMs?: number) {
  return {
    repository: "velz-cmd/Meridian",
    branch: "main",
    commitSha: "a".repeat(40),
    findingIds: ["fnd_1"],
    operation: "verified_cleanup_pr" as const,
    validationTimeMs,
  };
}

test("accepts a verified block timestamp inside the original quote window", () => {
  const paidAt = Date.parse("2026-07-25T20:30:00.000Z");
  assert.equal(
    isTransferTimestampWithinQuoteWindow({
      blockTimestampMs: paidAt,
      quoteCreatedAt: createdAt,
      quoteExpiresAt: expiresAt,
    }),
    true
  );
  assert.equal(validateQuoteBinding(quote(), bindingContext(paidAt)).ok, true);
});

test("rejects a transfer mined after quote expiry", () => {
  const paidAt = Date.parse("2026-07-25T20:37:02.000Z");
  assert.equal(
    isTransferTimestampWithinQuoteWindow({
      blockTimestampMs: paidAt,
      quoteCreatedAt: createdAt,
      quoteExpiresAt: expiresAt,
    }),
    false
  );
});

test("rejects an old transfer outside the bounded clock-skew allowance", () => {
  const paidAt = Date.parse("2026-07-25T20:21:30.000Z");
  assert.equal(
    isTransferTimestampWithinQuoteWindow({
      blockTimestampMs: paidAt,
      quoteCreatedAt: createdAt,
      quoteExpiresAt: expiresAt,
    }),
    false
  );
});

test("an expired unpaid quote remains expired at current time", () => {
  const result = validateQuoteBinding(
    quote(),
    bindingContext(Date.parse("2026-07-26T00:00:00.000Z"))
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, "expired");
});

test("a funded, verified quote remains usable after its payment window", () => {
  const result = validateQuoteBinding(
    quote({
      status: "funded",
      lifecycleStatus: "funded",
      paymentStatus: "verified",
      paymentReference: `0x${"b".repeat(64)}`,
    }),
    bindingContext(Date.parse("2026-07-26T00:00:00.000Z"))
  );
  assert.equal(result.ok, true);
});

