import assert from "node:assert/strict";
import {
  assertNoSecretsInSandboxEnv,
  buildUntrustedSandboxEnv,
  isBlockedSecretEnvKey,
} from "../src/lib/sandbox/secret-firewall";
import {
  denyUnlessTenantOwns,
  resolveTenantIdentity,
  tenantDenialResponse,
} from "../src/lib/tenant/request-auth";
import { capacityQueuedResponse } from "../src/lib/deep-scan/capacity";
import { stagePercent } from "../src/lib/deep-scan/types";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("production-worker-tenant-sandbox");

test("secret firewall strips GitHub App and signing keys", () => {
  const env = buildUntrustedSandboxEnv({
    PATH: "/usr/bin",
    HOME: "/tmp",
    GITHUB_APP_PRIVATE_KEY: "SECRET",
    RECEIPT_SIGNING_PRIVATE_KEY: "SECRET",
    OKX_API_KEY: "SECRET",
    SUPABASE_SERVICE_ROLE_KEY: "SECRET",
    WORKER_API_KEY: "SECRET",
    npm_config_cache: "/tmp/npm",
    CI: "true",
  } as unknown as NodeJS.ProcessEnv);
  assert.equal(env.GITHUB_APP_PRIVATE_KEY, undefined);
  assert.equal(env.RECEIPT_SIGNING_PRIVATE_KEY, undefined);
  assert.equal(env.OKX_API_KEY, undefined);
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(env.WORKER_API_KEY, undefined);
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.REPODIET_SANDBOX, "untrusted");
  assert.equal(isBlockedSecretEnvKey("GREEN_PR_SIGNING_PRIVATE_KEY"), true);
  assert.doesNotThrow(() => assertNoSecretsInSandboxEnv(env));
});

test("tenant denial does not leak resource existence", () => {
  const denial = denyUnlessTenantOwns({
    resourceTenantId: "okx_buyer_a",
    requestTenantId: "okx_buyer_b",
  });
  assert.ok(denial);
  const response = tenantDenialResponse(denial!, 404);
  assert.equal(response.status, 404);
  assert.equal(response.body.code, "TASK_NOT_FOUND");
  assert.match(response.body.message, /not found/i);
});

test("resolveTenantIdentity prefers explicit buyer headers", () => {
  const request = new Request("https://example.com/api/deep-scans/x", {
    headers: {
      "x-okx-buyer-id": "buyer_42",
      "x-buyer-wallet": "0xABC",
    },
  });
  const identity = resolveTenantIdentity(request);
  assert.equal(identity.tenantId, "okx_buyer_42");
  assert.equal(identity.source, "header");
});

test("capacity response is QUEUED + CAPACITY_LIMIT not 504", () => {
  const body = capacityQueuedResponse({
    taskId: "deep_scan_test",
    statusUrl: "/api/deep-scans/deep_scan_test",
    queuePosition: 3,
    reason: "GLOBAL",
  });
  assert.equal(body.status, "QUEUED");
  assert.equal(body.code, "CAPACITY_LIMIT");
  assert.equal(body.retryable, true);
  assert.equal(body.queuePosition, 3);
});

test("deep-scan stage ladder includes CLAIMED and terminal failures", () => {
  assert.ok(stagePercent("CLAIMED") > stagePercent("QUEUED"));
  assert.equal(stagePercent("FAILED_TERMINAL"), 100);
  assert.equal(stagePercent("READY"), 100);
});

console.log("production-worker-tenant-sandbox: all passed");
