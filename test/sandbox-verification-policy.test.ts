import assert from "node:assert/strict";
import {
  isPreExistingRequiredFailure,
  resolveSandboxVerificationOutcome,
  sandboxPhasePassed,
} from "../src/lib/execution/sandbox-verification-policy";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("sandbox-verification-policy");

test("Meridian-style: lint fails but build passes → phase passed", () => {
  assert.equal(
    sandboxPhasePassed([
      { name: "lint", exitCode: 1, stderr: "eslint errors" },
      { name: "build", exitCode: 0, stderr: "" },
    ]),
    true
  );
});

test("lint-only repo: lint failure blocks when no build/typecheck", () => {
  assert.equal(
    sandboxPhasePassed([{ name: "lint", exitCode: 1, stderr: "eslint errors" }]),
    false
  );
});

test("pre-existing lint on baseline+patched still verifies when build passes", () => {
  const result = resolveSandboxVerificationOutcome({
    baselineInstallExit: 0,
    baselineChecks: [
      { name: "lint", exitCode: 1, stderr: "eslint" },
      { name: "build", exitCode: 0, stderr: "" },
    ],
    patchedInstallExit: 0,
    patchedChecks: [
      { name: "lint", exitCode: 1, stderr: "eslint" },
      { name: "build", exitCode: 0, stderr: "" },
    ],
  });
  assert.equal(result.status, "verified");
});

test("patched build regression fails delivery", () => {
  const result = resolveSandboxVerificationOutcome({
    baselineInstallExit: 0,
    baselineChecks: [
      { name: "lint", exitCode: 1, stderr: "eslint" },
      { name: "build", exitCode: 0, stderr: "" },
    ],
    patchedInstallExit: 0,
    patchedChecks: [
      { name: "lint", exitCode: 1, stderr: "eslint" },
      { name: "build", exitCode: 1, stderr: "next build failed" },
    ],
  });
  assert.equal(result.status, "regression_failed");
  assert.match(String(result.error), /patched build/);
});

test("baseline install failure hard-blocks", () => {
  const result = resolveSandboxVerificationOutcome({
    baselineInstallExit: 1,
    baselineChecks: [],
    patchedInstallExit: 0,
    patchedChecks: [],
  });
  assert.equal(result.status, "baseline_blocked");
  assert.match(String(result.error), /dependency installation/);
});

test("Meridian: same pre-existing build failure baseline+patched → verified", () => {
  const baseline = [{ name: "build", exitCode: 1, stderr: "Error: Missing env NEXT_PUBLIC_X" }];
  const patched = [{ name: "build", exitCode: 1, stderr: "Error: Missing env NEXT_PUBLIC_X" }];
  assert.equal(isPreExistingRequiredFailure(baseline, patched), true);
  const result = resolveSandboxVerificationOutcome({
    baselineInstallExit: 0,
    baselineChecks: baseline,
    patchedInstallExit: 0,
    patchedChecks: patched,
  });
  assert.equal(result.status, "verified");
});

test("pre-existing build with same exit code verifies even if stderr differs slightly", () => {
  const result = resolveSandboxVerificationOutcome({
    baselineInstallExit: 0,
    baselineChecks: [{ name: "build", exitCode: 1, stderr: "Missing env A" }],
    patchedInstallExit: 0,
    patchedChecks: [{ name: "build", exitCode: 1, stderr: "Type error in src/cleanup.ts" }],
  });
  // Same required script + same exit code → pre-existing; cleanup did not newly break a passing baseline.
  assert.equal(result.status, "verified");
});

test("new build failure after clean baseline is regression", () => {
  const result = resolveSandboxVerificationOutcome({
    baselineInstallExit: 0,
    baselineChecks: [{ name: "build", exitCode: 0, stderr: "" }],
    patchedInstallExit: 0,
    patchedChecks: [{ name: "build", exitCode: 1, stderr: "Type error" }],
  });
  assert.equal(result.status, "regression_failed");
});

console.log("sandbox-verification-policy: all passed");
