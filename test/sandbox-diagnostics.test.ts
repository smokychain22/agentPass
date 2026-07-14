import assert from "node:assert/strict";
import { patchedErrorsAreSubsetOfBaseline } from "../src/lib/execution/sandbox-diagnostics";
import {
  isPreExistingRequiredFailure,
  resolveSandboxVerificationOutcome,
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

console.log("sandbox-diagnostics");

test("Test 6: env baseline exit 1 + syntax patched exit 1 is PATCH_REGRESSION", () => {
  const baseline = [
    {
      name: "build",
      exitCode: 1,
      stderr: "Error: Missing env NEXT_PUBLIC_X",
    },
  ];
  const patched = [
    {
      name: "build",
      exitCode: 1,
      stderr: "./src/lib/token-quote.ts:2:3 Type error: Unexpected token",
    },
  ];
  assert.equal(patchedErrorsAreSubsetOfBaseline(baseline[0], patched[0]), false);
  assert.equal(isPreExistingRequiredFailure(baseline, patched), false);
  const result = resolveSandboxVerificationOutcome({
    baselineInstallExit: 0,
    baselineChecks: baseline,
    patchedInstallExit: 0,
    patchedChecks: patched,
  });
  assert.equal(result.status, "regression_failed");
});

test("same env error on baseline and patched may be pre-existing", () => {
  const baseline = [{ name: "build", exitCode: 1, stderr: "Error: Missing env NEXT_PUBLIC_X" }];
  const patched = [{ name: "build", exitCode: 1, stderr: "Error: Missing env NEXT_PUBLIC_X" }];
  assert.equal(isPreExistingRequiredFailure(baseline, patched), true);
});

test("equal exit code alone does not verify when stderr differs unparseably", () => {
  const baseline = [{ name: "build", exitCode: 1, stderr: "opaque failure A" }];
  const patched = [{ name: "build", exitCode: 1, stderr: "opaque failure B completely different" }];
  assert.equal(isPreExistingRequiredFailure(baseline, patched), false);
});

console.log("sandbox-diagnostics: all passed");
