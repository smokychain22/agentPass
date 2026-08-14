import assert from "node:assert/strict";

/**
 * PR A — server-side sandbox model, claim-lease semantics.
 *
 * Sandbox patch validation is blocked in production because Vercel's
 * serverless runtime has no git binary (see docs/A2A_SANDBOX_VALIDATION_PLAN.md).
 * This suite pins the claim/lease mechanics that let an external worker
 * (GitHub Actions on-demand validate job, wired up in a follow-up PR) safely
 * own a specific sandbox run without a second worker racing it — mirroring
 * the deep-scan `claimDeepScanJobById` lease pattern.
 */

process.env.UPSTASH_REDIS_REST_URL = "";
process.env.UPSTASH_REDIS_REST_TOKEN = "";

import {
  assertSandboxRunClaim,
  claimSandboxRun,
  createSandboxRun,
  failSandboxRun,
  getSandboxRun,
  heartbeatSandboxRun,
  SandboxRunClaimError,
  updateSandboxRun,
} from "../src/lib/execution/sandbox-run-store";
import type { SandboxRunPayload } from "../src/lib/execution/sandbox-run-types";

function test(name: string, fn: () => Promise<void>) {
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

let seq = 0;
function fixturePayload(): SandboxRunPayload {
  seq += 1;
  return {
    cleanupRunId: `cleanup_run_claims_${Date.now()}_${seq}`,
    repositoryOwner: "velz-cmd",
    repositoryName: "repodiet-e2e-test",
    branch: "main",
    baseCommitSha: "5df7c518abc0000000000000000000000000000",
    repoUrl: "https://github.com/velz-cmd/repodiet-e2e-test",
    edits: [{ path: "unused-file.ts", content: "" }],
    changeOperations: [
      {
        id: "op1",
        findingIds: ["f1"],
        transformerId: "safe-delete",
        type: "delete",
        filePath: "unused-file.ts",
        baseBlobSha: null,
        baseContentHash: null,
        beforeContent: "export const x = 1;",
        afterContent: null,
        linesAdded: 0,
        linesRemoved: 1,
      },
    ],
  };
}

console.log("Sandbox run claim-lease semantics");

async function main() {
  await test("claim succeeds for a fresh queued run and returns a claimToken + claimHandle", async () => {
    const run = await createSandboxRun(fixturePayload());
    assert.equal(run.status, "queued");

    const claim = await claimSandboxRun(run.id, "github-actions/ubuntu-latest");
    assert.ok(claim.ok, "expected claim to succeed");
    if (!claim.ok) return;
    assert.equal(claim.alreadyClaimed, false);
    assert.ok(claim.run.claimToken, "expected a claimToken");
    assert.ok(claim.run.claimHandle, "expected a claimHandle");
    assert.equal(claim.run.claimedBy, "github-actions/ubuntu-latest");
    assert.equal(claim.run.status, "starting", "queued should advance to starting on claim");
  });

  await test("re-claiming with the same worker while the lease is live is idempotent", async () => {
    const run = await createSandboxRun(fixturePayload());
    const first = await claimSandboxRun(run.id, "worker-a");
    assert.ok(first.ok);
    if (!first.ok) return;

    const second = await claimSandboxRun(run.id, "worker-a");
    assert.ok(second.ok);
    if (!second.ok) return;
    assert.equal(second.alreadyClaimed, true);
    assert.equal(second.run.claimToken, first.run.claimToken, "claim token must not change on idempotent re-claim");
  });

  await test("a different worker cannot claim while another worker's lease is live", async () => {
    const run = await createSandboxRun(fixturePayload());
    const first = await claimSandboxRun(run.id, "worker-a");
    assert.ok(first.ok);

    const second = await claimSandboxRun(run.id, "worker-b");
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.code, "CLAIMED_BY_OTHER");
  });

  await test("a different worker may reclaim after the lease expires, and gets a fresh claimToken", async () => {
    const run = await createSandboxRun(fixturePayload());
    const first = await claimSandboxRun(run.id, "worker-a");
    assert.ok(first.ok);
    if (!first.ok) return;

    // Simulate lease expiry.
    await updateSandboxRun(run.id, { leaseExpiresAt: new Date(Date.now() - 1000).toISOString() });

    const second = await claimSandboxRun(run.id, "worker-b");
    assert.ok(second.ok, "expected reclaim after lease expiry to succeed");
    if (!second.ok) return;
    assert.equal(second.alreadyClaimed, false);
    assert.equal(second.run.claimedBy, "worker-b");
    assert.notEqual(second.run.claimToken, first.run.claimToken, "reclaim must mint a fresh claim token");
    assert.notEqual(second.run.claimHandle, first.run.claimHandle, "reclaim must mint a fresh claim handle");
  });

  await test("a terminal run cannot be claimed", async () => {
    const run = await createSandboxRun(fixturePayload());
    await failSandboxRun(run.id, "SANDBOX_EXECUTION_FAILED", "boom");

    const claim = await claimSandboxRun(run.id, "worker-a");
    assert.equal(claim.ok, false);
    if (claim.ok) return;
    assert.equal(claim.code, "TERMINAL");
  });

  await test("assertSandboxRunClaim rejects a wrong claimToken and an expired lease", async () => {
    const run = await createSandboxRun(fixturePayload());
    const claimed = await claimSandboxRun(run.id, "worker-a");
    assert.ok(claimed.ok);
    if (!claimed.ok) return;

    assert.throws(
      () => assertSandboxRunClaim(claimed.run, "worker-a", "wrong-token"),
      SandboxRunClaimError
    );

    const expired = { ...claimed.run, leaseExpiresAt: new Date(Date.now() - 1000).toISOString() };
    assert.throws(() => assertSandboxRunClaim(expired, "worker-a", claimed.run.claimToken!), (err: unknown) => {
      return err instanceof SandboxRunClaimError && err.code === "LEASE_EXPIRED";
    });
  });

  await test("heartbeatSandboxRun extends the lease and updates progress for a valid claim, and rejects an invalid one", async () => {
    const run = await createSandboxRun(fixturePayload());
    const claimed = await claimSandboxRun(run.id, "worker-a");
    assert.ok(claimed.ok);
    if (!claimed.ok) return;

    const beforeLease = claimed.run.leaseExpiresAt!;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const hb = await heartbeatSandboxRun(run.id, "worker-a", claimed.run.claimToken!, "cloning repo", "cloning");
    assert.ok(hb);
    assert.equal(hb?.status, "cloning");
    assert.ok(new Date(hb!.leaseExpiresAt!).getTime() >= new Date(beforeLease).getTime());

    let threw = false;
    try {
      await heartbeatSandboxRun(run.id, "worker-a", "not-the-real-token");
    } catch (err) {
      threw = err instanceof SandboxRunClaimError;
    }
    assert.ok(threw, "heartbeat with a wrong claim token must throw");

    const unaffected = await getSandboxRun(run.id);
    assert.equal(unaffected?.status, "cloning", "failed heartbeat must not have mutated state");
  });

  console.log("Sandbox run claim-lease semantics: all passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
