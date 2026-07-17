import assert from "node:assert/strict";
import { assertDeepScanClaim, DeepScanClaimError } from "../src/lib/deep-scan/job-store";
import type { DeepScanJob } from "../src/lib/deep-scan/types";
import {
  classifyUntrustedSandbox,
  packageScriptsAllowed,
  SandboxIncompleteError,
} from "../src/lib/sandbox/untrusted-runner";
import { buildUntrustedSandboxEnv } from "../src/lib/sandbox/secret-firewall";

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    await fn();
    console.log(`  ✓ ${name}`);
  })();
}

function fakeJob(overrides: Partial<DeepScanJob> = {}): DeepScanJob {
  const t = new Date().toISOString();
  return {
    id: "deep_scan_test",
    status: "running",
    stage: "CLAIMED",
    progress: { stage: "CLAIMED", percent: 5, updatedAt: t },
    request: { repoUrl: "https://github.com/acme/app", tenantId: "okx_a" },
    tenantId: "okx_a",
    claimedBy: "worker_a",
    claimToken: "claim_token_a",
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    attemptCount: 1,
    statusHistory: [],
    createdAt: t,
    updatedAt: t,
    ...overrides,
  };
}

async function run() {
  console.log("double-claim-and-sandbox");

  await test("claim token mismatch is rejected", () => {
    assert.throws(
      () => assertDeepScanClaim(fakeJob(), "worker_a", "wrong_token"),
      (err: unknown) => err instanceof DeepScanClaimError && err.code === "CLAIM_MISMATCH"
    );
  });

  await test("other worker cannot use claim", () => {
    assert.throws(
      () => assertDeepScanClaim(fakeJob(), "worker_b", "claim_token_a"),
      (err: unknown) => err instanceof DeepScanClaimError && err.code === "CLAIM_MISMATCH"
    );
  });

  await test("matching worker + claim token passes", () => {
    assert.doesNotThrow(() => assertDeepScanClaim(fakeJob(), "worker_a", "claim_token_a"));
  });

  await test("sandbox classification is incomplete without docker flag", () => {
    delete process.env.REPODIET_DOCKER_SANDBOX;
    delete process.env.REPODIET_UNTRUSTED_SANDBOX;
    assert.equal(classifyUntrustedSandbox(), "SANDBOX_INCOMPLETE");
    assert.equal(packageScriptsAllowed(), false);
    assert.throws(() => {
      throw new SandboxIncompleteError();
    }, (err: unknown) => err instanceof SandboxIncompleteError);
  });

  await test("untrusted env still strips worker and signing secrets", () => {
    const env = buildUntrustedSandboxEnv({
      PATH: "/usr/bin",
      WORKER_API_KEY: "x",
      UPSTASH_REDIS_REST_TOKEN: "x",
      GITHUB_APP_PRIVATE_KEY: "x",
      REPODIET_RECEIPT_PRIVATE_KEY: "x",
    } as NodeJS.ProcessEnv);
    assert.equal(env.WORKER_API_KEY, undefined);
    assert.equal(env.UPSTASH_REDIS_REST_TOKEN, undefined);
    assert.equal(env.GITHUB_APP_PRIVATE_KEY, undefined);
  });

  console.log("double-claim-and-sandbox: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
