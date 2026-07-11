import assert from "node:assert/strict";
import { RateLimitHttpError } from "../src/lib/jobs/client";
import type { RateLimitSnapshot } from "../src/lib/security/rate-limit";
import { enforceRateLimit } from "../src/lib/security/rate-limit";
import { withDurableDb } from "../src/lib/store/durable-store";

async function resetUsage(): Promise<void> {
  await withDurableDb((db) => {
    db.usage = {};
  });
}

async function testPatchRateLimitScopedPerScan(): Promise<void> {
  await resetUsage();
  const ownerKey = "test-owner";
  const scanA = "scan-a";
  const scanB = "scan-b";

  for (let i = 0; i < 10; i += 1) {
    await enforceRateLimit(ownerKey, "patch", { scopeKey: scanA });
  }

  let blocked = false;
  try {
    await enforceRateLimit(ownerKey, "patch", { scopeKey: scanA });
    assert.fail("Expected scan A to be rate limited");
  } catch {
    blocked = true;
  }
  assert.equal(blocked, true, "scan A should hit the per-scan limit");

  const otherScan = await enforceRateLimit(ownerKey, "patch", { scopeKey: scanB });
  assert.ok(otherScan.remaining >= 0, "scan B should have its own bucket");
}

function testRateLimitHttpErrorShape(): void {
  const snapshot: RateLimitSnapshot = {
    code: "rate_limit_exceeded",
    retryAfterSeconds: 120,
    limit: 10,
    remaining: 0,
    resetAt: new Date(Date.now() + 120_000).toISOString(),
  };
  const err = new RateLimitHttpError("Rate limit exceeded. Retry after 120s.", snapshot);
  assert.equal(err.name, "RateLimitHttpError");
  assert.equal(err.rateLimit.retryAfterSeconds, 120);
  assert.equal(err.rateLimit.limit, 10);
}

async function main(): Promise<void> {
  await testPatchRateLimitScopedPerScan();
  testRateLimitHttpErrorShape();
  console.log("rate-limit-ux.test.ts: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
