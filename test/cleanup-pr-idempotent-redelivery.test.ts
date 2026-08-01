import assert from "node:assert/strict";
import {
  classifyDeleteOutcome,
  hasNoDeliverableChange,
} from "../src/lib/operator/create-cleanup-pr";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

/**
 * Reproduced live against velz-cmd/repodiet-e2e-test: after the ledger fix
 * correctly routed an identical retry back to the existing branch+PR
 * (#136/#137), delivering it a second time threw NO_SAFE_CANDIDATES —
 * "No approved cleanup operation was applied" — instead of returning the
 * existing PR. The requested delete was already absent from the reused
 * branch (the first delivery had already removed it), and that was
 * indistinguishable from "nothing was ever approved".
 */
console.log("cleanup-pr-idempotent-redelivery");

test("a real deletion on a fresh branch classifies as applied", () => {
  assert.equal(classifyDeleteOutcome(true, false), "applied");
});

test("a real deletion on a reused branch also classifies as applied", () => {
  assert.equal(classifyDeleteOutcome(true, true), "applied");
});

test("a missing path on a REUSED branch classifies as already_satisfied — the idempotent-retry case", () => {
  assert.equal(classifyDeleteOutcome(false, true), "already_satisfied");
});

test("a missing path on a FRESH branch classifies as not_found — a genuine anomaly, not absorbed", () => {
  assert.equal(classifyDeleteOutcome(false, false), "not_found");
});

test("no edits, no new deletes, nothing already satisfied -> genuinely no deliverable change", () => {
  assert.equal(
    hasNoDeliverableChange({ editedCount: 0, deletedCount: 0, alreadySatisfiedCount: 0 }),
    true
  );
});

test("a fresh delivery with a new deletion has a deliverable change", () => {
  assert.equal(
    hasNoDeliverableChange({ editedCount: 0, deletedCount: 1, alreadySatisfiedCount: 0 }),
    false
  );
});

test("an edit-only delivery has a deliverable change", () => {
  assert.equal(
    hasNoDeliverableChange({ editedCount: 1, deletedCount: 0, alreadySatisfiedCount: 0 }),
    false
  );
});

test("an idempotent retry where everything was already satisfied is NOT a failure — this is the exact fix", () => {
  assert.equal(
    hasNoDeliverableChange({ editedCount: 0, deletedCount: 0, alreadySatisfiedCount: 1 }),
    false
  );
});

console.log("cleanup-pr-idempotent-redelivery: all passed");
