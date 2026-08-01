import assert from "node:assert/strict";
import { nanoid } from "nanoid";
import {
  getCleanupPrDelivery,
  recordCleanupPrDelivery,
} from "../src/lib/operator/cleanup-pr-delivery-ledger";

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

/**
 * Reproduces and closes the idempotency defect found live against
 * velz-cmd/repodiet-e2e-test: submitting the exact same {patchKitId,
 * scanId, approvedPaths} to POST /api/github/create-cleanup-pr twice opened
 * PR #3 and then a second PR #4 for the same one-line deletion, because
 * createCleanupPullRequest had no memory of a prior delivery for that
 * patch kit.
 */
async function run() {
  console.log("cleanup-pr-delivery-ledger");

  await test("a patch kit with no recorded delivery returns undefined", async () => {
    const patchKitId = `patchkit_test_${nanoid(8)}`;
    const record = await getCleanupPrDelivery(patchKitId);
    assert.equal(record, undefined);
  });

  await test("a recorded delivery round-trips exactly", async () => {
    const patchKitId = `patchkit_test_${nanoid(8)}`;
    await recordCleanupPrDelivery(patchKitId, {
      owner: "velz-cmd",
      repo: "repodiet-e2e-test",
      prNumber: 3,
      branch: "repodiet/cleanup-20260801-SZphT6",
    });
    const record = await getCleanupPrDelivery(patchKitId);
    assert.ok(record);
    assert.equal(record!.owner, "velz-cmd");
    assert.equal(record!.repo, "repodiet-e2e-test");
    assert.equal(record!.prNumber, 3);
    assert.equal(record!.branch, "repodiet/cleanup-20260801-SZphT6");
    assert.ok(record!.deliveredAt, "must stamp when the delivery was recorded");
  });

  await test("a second recording for the same patch kit overwrites — the ledger always reflects the latest delivery attempt", async () => {
    const patchKitId = `patchkit_test_${nanoid(8)}`;
    await recordCleanupPrDelivery(patchKitId, {
      owner: "velz-cmd",
      repo: "repodiet-e2e-test",
      prNumber: 3,
      branch: "repodiet/cleanup-20260801-SZphT6",
    });
    await recordCleanupPrDelivery(patchKitId, {
      owner: "velz-cmd",
      repo: "repodiet-e2e-test",
      prNumber: 3,
      branch: "repodiet/cleanup-20260801-SZphT6-repaired",
    });
    const record = await getCleanupPrDelivery(patchKitId);
    assert.equal(record!.branch, "repodiet/cleanup-20260801-SZphT6-repaired");
  });

  await test("different patch kits never collide — each gets its own independent record", async () => {
    const a = `patchkit_test_${nanoid(8)}`;
    const b = `patchkit_test_${nanoid(8)}`;
    await recordCleanupPrDelivery(a, {
      owner: "velz-cmd",
      repo: "repodiet-e2e-test",
      prNumber: 3,
      branch: "branch-a",
    });
    await recordCleanupPrDelivery(b, {
      owner: "velz-cmd",
      repo: "repodiet-e2e-test",
      prNumber: 4,
      branch: "branch-b",
    });
    const recordA = await getCleanupPrDelivery(a);
    const recordB = await getCleanupPrDelivery(b);
    assert.equal(recordA!.prNumber, 3);
    assert.equal(recordB!.prNumber, 4);
  });

  console.log("cleanup-pr-delivery-ledger: all passed");
}

run();
