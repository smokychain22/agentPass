import assert from "node:assert/strict";
import { FREE_CLEANUP_LIMIT, QUICK_CLEANUP_LIMIT, freeCleanupCta } from "../src/lib/cleanup/eligibility";
import type { Finding } from "../src/lib/findings/types";
import { quoteCleanupPrPrice } from "../src/lib/pricing/quote";
import { createTaskQuote, validateTaskQuote } from "../src/lib/execution/task-quote";

function mockFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    type: "unused_file",
    title: "Unused file",
    files: ["archive/old.tsx"],
    confidence: 0.9,
    confidenceReason: "test",
    severity: "low",
    action: "safe_candidate",
    reason: "No imports",
    source: "knip",
    sourceMode: "native",
    evidence: { summary: "test", signals: [] },
    ...overrides,
  };
}

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("RepoDiet product vision tests");

test("free proof limit is one", () => {
  assert.equal(FREE_CLEANUP_LIMIT, 1);
  assert.equal(QUICK_CLEANUP_LIMIT, 5);
});

test("free proof CTA label", () => {
  const cta = freeCleanupCta([mockFinding(), mockFinding({ id: "f2" })]);
  assert.equal(cta.label, "Fix One Safe Issue Free");
  assert.equal(cta.count, 1);
});

test("cleanup PR small repo price", () => {
  assert.equal(quoteCleanupPrPrice(100).amountUsdt, 1);
});

test("cleanup PR medium repo price", () => {
  assert.equal(quoteCleanupPrPrice(200).amountUsdt, 2);
});

test("cleanup PR large repo price", () => {
  assert.equal(quoteCleanupPrPrice(500).amountUsdt, 3);
});

test("task quote rejects commit mismatch", () => {
  const quote = createTaskQuote({
    repository: "owner/repo",
    branch: "main",
    commitSha: "abc",
    findingIds: ["f1"],
    operation: "free_proof",
  });
  const result = validateTaskQuote(quote, {
    repository: "owner/repo",
    branch: "main",
    commitSha: "def",
    findingIds: ["f1"],
    operation: "free_proof",
  });
  assert.equal(result.ok, false);
});

console.log("All product vision tests passed.");
