import assert from "node:assert/strict";
import { checkPatchValidationFreshness } from "../src/lib/operator/cleanup-delivery-guard";

/**
 * PR C — delivery-time fingerprint re-binding.
 *
 * A "passed" patchValidation on a patch kit proves some prior edit set was
 * git-apply-validated (by the sandbox, local dev, or Vercel Sandbox path) —
 * not that it covers the exact paths about to be delivered right now. This
 * pins that create-cleanup-pr.ts's delivery gate (checkPatchValidationFreshness)
 * refuses to deliver a path the recorded validation never actually saw, and
 * refuses when the validation ran against a different base commit than the
 * current scan — "validate patch A, deliver patch B" must fail closed.
 */

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("patch-validation-freshness");

const BASE_SHA = "5df7c518abc0000000000000000000000000000";

test("delivery paths that exactly match the validated set pass", () => {
  const result = checkPatchValidationFreshness({
    validatedPaths: ["src/a.ts", "src/b.ts"],
    deliveredPaths: ["src/a.ts", "src/b.ts"],
    validationBaseCommitSha: BASE_SHA,
    scanCommitSha: BASE_SHA,
  });
  assert.equal(result.ok, true);
});

test("a delivery path outside the validated set fails closed", () => {
  const result = checkPatchValidationFreshness({
    validatedPaths: ["src/a.ts"],
    deliveredPaths: ["src/a.ts", "src/sneaky.ts"],
    validationBaseCommitSha: BASE_SHA,
    scanCommitSha: BASE_SHA,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "UNVALIDATED_PATHS");
  assert.deepEqual(result.unvalidatedPaths, ["src/sneaky.ts"]);
});

test("a narrowed delivery (fewer paths than validated) still passes — narrowing is safe", () => {
  const result = checkPatchValidationFreshness({
    validatedPaths: ["src/a.ts", "src/b.ts", "src/c.ts"],
    deliveredPaths: ["src/a.ts"],
    validationBaseCommitSha: BASE_SHA,
    scanCommitSha: BASE_SHA,
  });
  assert.equal(result.ok, true);
});

test("no recorded validated paths fails closed for any real delivery", () => {
  const result = checkPatchValidationFreshness({
    validatedPaths: undefined,
    deliveredPaths: ["src/a.ts"],
    validationBaseCommitSha: BASE_SHA,
    scanCommitSha: BASE_SHA,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "UNVALIDATED_PATHS");
});

test("no delivered paths at all is vacuously fine regardless of validated set", () => {
  const result = checkPatchValidationFreshness({
    validatedPaths: undefined,
    deliveredPaths: [],
    validationBaseCommitSha: BASE_SHA,
    scanCommitSha: BASE_SHA,
  });
  assert.equal(result.ok, true);
});

test("a base-commit mismatch between validation and the current scan fails closed", () => {
  const result = checkPatchValidationFreshness({
    validatedPaths: ["src/a.ts"],
    deliveredPaths: ["src/a.ts"],
    validationBaseCommitSha: BASE_SHA,
    scanCommitSha: "0000000000000000000000000000000000dead",
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "COMMIT_DRIFT");
});

test("a short-SHA prefix match between validation and scan commit is accepted, not flagged as drift", () => {
  const result = checkPatchValidationFreshness({
    validatedPaths: ["src/a.ts"],
    deliveredPaths: ["src/a.ts"],
    validationBaseCommitSha: BASE_SHA.slice(0, 12),
    scanCommitSha: BASE_SHA,
  });
  assert.equal(result.ok, true);
});

test("a missing validation base commit (legacy local-dev path) does not block on commit drift", () => {
  const result = checkPatchValidationFreshness({
    validatedPaths: ["src/a.ts"],
    deliveredPaths: ["src/a.ts"],
    validationBaseCommitSha: undefined,
    scanCommitSha: BASE_SHA,
  });
  assert.equal(result.ok, true);
});

test("commit drift is checked before path coverage — the more specific reason surfaces", () => {
  const result = checkPatchValidationFreshness({
    validatedPaths: ["src/a.ts"],
    deliveredPaths: ["src/sneaky.ts"],
    validationBaseCommitSha: BASE_SHA,
    scanCommitSha: "0000000000000000000000000000000000dead",
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "COMMIT_DRIFT");
});

console.log("patch-validation-freshness: all passed");
