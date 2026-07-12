import assert from "node:assert/strict";
import {
  userFacingPatchFailure,
  userFacingSandboxProgress,
} from "../src/lib/patch-kit/user-facing-messages";
import type { PatchKitPayload } from "../src/lib/patch-kit/types";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("user-facing-messages");

test("sandbox progress hides internal labels", () => {
  assert.equal(userFacingSandboxProgress("Verifying repository baseline"), "Checking repository dependencies…");
  assert.equal(userFacingSandboxProgress("sandbox_run_abc123"), "Running verification…");
});

test("patch failure uses plain language", () => {
  const kit = {
    patchValidation: {
      status: "failed",
      gitPatchValidation: { status: "failed", failureCode: "GIT_PATCH_INVALID" },
    },
  } as PatchKitPayload;
  const message = userFacingPatchFailure(kit);
  assert.match(message, /Regenerate Quick Cleanup/);
  assert.doesNotMatch(message, /Git error:/);
});

test("git passed with blocked verification explains next step", () => {
  const kit = {
    patchValidation: { status: "passed" },
    repositoryVerification: {
      status: "blocked",
      error: "baseline dependency installation failed in sandbox.",
      installAttempts: [],
      checks: [],
    },
  } as PatchKitPayload;
  assert.match(userFacingPatchFailure(kit), /Git validation passed/i);
});

console.log("user-facing-messages: all passed");
