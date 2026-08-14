import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * PR A added a server-side claim/verify/complete model for external sandbox
 * workers but left `dispatchSandboxExecution` unchanged (pinned by this same
 * file at that point in history) — production stayed exactly `pending_sandbox`
 * until this PR wired up the GitHub Actions worker.
 *
 * This now pins the OPPOSITE, deliberate invariant: in the serverless runtime,
 * when the Actions dispatcher is configured, sandbox execution goes to
 * GitHub Actions FIRST — not back to the same git-less Vercel route. The old
 * self-post route is kept only as a fallback for deployments with Vercel
 * Sandbox provisioned, or with neither configured (behaviourally identical to
 * pre-PR-A production).
 */

const DISPATCH_SRC = readFileSync(
  path.join(process.cwd(), "src/lib/execution/dispatch-sandbox-execution.ts"),
  "utf8"
);

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("Sandbox dispatch GitHub Actions wiring invariant");

test("serverless dispatch tries the GitHub Actions sandbox dispatcher before the self-post fallback", () => {
  const actionsIdx = DISPATCH_SRC.indexOf("isSandboxActionsDispatcherConfigured");
  const selfPostIdx = DISPATCH_SRC.indexOf("/api/internal/sandbox-runs/execute");
  assert.ok(actionsIdx >= 0, "expected a reference to isSandboxActionsDispatcherConfigured");
  assert.ok(selfPostIdx >= 0, "expected the legacy self-post route to still exist as a fallback");
  assert.ok(actionsIdx < selfPostIdx, "the Actions dispatcher branch must be checked before the self-post fallback");
});

test("the Actions dispatch path fires a real repository_dispatch, not a local self-call", () => {
  assert.ok(
    /dispatchSandboxValidationWorkflow/.test(DISPATCH_SRC),
    "expected dispatchSandboxExecution to call dispatchSandboxValidationWorkflow"
  );
});

test("a dispatch nonce is minted and stored before the workflow is triggered", () => {
  assert.ok(/createDispatchNonce/.test(DISPATCH_SRC), "expected a fresh dispatch nonce per attempt");
  assert.ok(/storeDispatchNonce/.test(DISPATCH_SRC), "expected the nonce to be durably stored for claim-exchange to consume");
});

test("the local/dev inline execution path is untouched", () => {
  assert.ok(
    /runSandboxExecutionOnce/.test(DISPATCH_SRC),
    "the non-serverless inline path must still exist for local dev and tests"
  );
});

console.log("Sandbox dispatch GitHub Actions wiring invariant: all passed");
