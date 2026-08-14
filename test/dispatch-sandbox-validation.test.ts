import assert from "node:assert/strict";
import {
  dispatchSandboxValidationWorkflow,
  isSandboxActionsDispatcherConfigured,
  SANDBOX_REPOSITORY_DISPATCH_EVENT,
} from "../src/lib/github-actions/dispatch-sandbox-validation";
import { REPOSITORY_DISPATCH_EVENT } from "../src/lib/github-actions/dispatch-analysis";

function test(name: string, fn: () => Promise<void> | void) {
  return (async () => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      console.error(`  ✗ ${name}`);
      throw err;
    }
  })();
}

console.log("dispatch-sandbox-validation");

async function main() {
  await test("the sandbox event type is distinct from the analysis event type", () => {
    assert.notEqual(SANDBOX_REPOSITORY_DISPATCH_EVENT, REPOSITORY_DISPATCH_EVENT);
    assert.equal(SANDBOX_REPOSITORY_DISPATCH_EVENT, "repodiet_sandbox_validation");
  });

  await test("dispatcher is reported unconfigured without a dispatch token, without making a network call", async () => {
    const prevToken = process.env.REPODIET_ACTIONS_DISPATCH_TOKEN;
    delete process.env.REPODIET_ACTIONS_DISPATCH_TOKEN;
    try {
      assert.equal(isSandboxActionsDispatcherConfigured(), false);
      const result = await dispatchSandboxValidationWorkflow({
        runId: "sandbox_run_abc123",
        requestId: "req_abc123",
        dispatchNonce: "dn_".padEnd(24, "a"),
        environment: "production",
      });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.code, "DISPATCH_TOKEN_MISSING");
      assert.equal(result.retryable, false);
    } finally {
      if (prevToken !== undefined) process.env.REPODIET_ACTIONS_DISPATCH_TOKEN = prevToken;
    }
  });

  await test("an invalid runId is rejected before any network call, regardless of token config", async () => {
    process.env.REPODIET_ACTIONS_DISPATCH_TOKEN = "test-token-value";
    try {
      const result = await dispatchSandboxValidationWorkflow({
        runId: "not a valid run id!!",
        requestId: "req_abc123",
        dispatchNonce: "dn_".padEnd(24, "a"),
        environment: "production",
      });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.code, "INVALID_DISPATCH_PAYLOAD");
    } finally {
      delete process.env.REPODIET_ACTIONS_DISPATCH_TOKEN;
    }
  });

  await test("an invalid environment is rejected", async () => {
    const result = await dispatchSandboxValidationWorkflow({
      runId: "sandbox_run_abc123",
      requestId: "req_abc123",
      dispatchNonce: "dn_".padEnd(24, "a"),
      environment: "staging" as never,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "INVALID_DISPATCH_PAYLOAD");
  });

  await test("a too-short dispatch nonce is rejected", async () => {
    const result = await dispatchSandboxValidationWorkflow({
      runId: "sandbox_run_abc123",
      requestId: "req_abc123",
      dispatchNonce: "short",
      environment: "production",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "INVALID_DISPATCH_PAYLOAD");
  });

  console.log("dispatch-sandbox-validation: all passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
