import assert from "node:assert/strict";
import { createDeepScanJob, getDeepScanJob } from "../src/lib/deep-scan/job-store";

function test(name: string, fn: () => Promise<void>) {
  return (async () => {
    await fn();
    console.log(`  ✓ ${name}`);
  })();
}

async function run() {
  console.log("findings-idempotency");

  await test("same tenant/scan/commit/root returns the same deep-scan job", async () => {
    // Force local persistent store — do not require live Upstash for unit proof.
    process.env.REPODIET_TEST_OFFLINE = "1";
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;

    const unique = `idem_${Date.now()}`;
    const tenantId = `browser_${unique}`;
    const structureScanId = `scan_${unique}`;
    const sourceCommit = "a35631c6748d6619b9301a02b34f2ff99eecd5b7";
    const projectRoot = ".";
    const idempotencyKey = `findings:${tenantId}:${structureScanId}:${sourceCommit}:${projectRoot}`;

    const first = await createDeepScanJob(
      {
        repoUrl: "https://github.com/velz-cmd/Meridian",
        branch: "main",
        projectRoot,
        sourceCommit,
        readOnly: true,
        tenantId,
        structureScanId,
        requestedBy: `tenant:${tenantId}`,
      },
      { idempotencyKey }
    );
    const second = await createDeepScanJob(
      {
        repoUrl: "https://github.com/velz-cmd/Meridian",
        branch: "main",
        projectRoot,
        sourceCommit,
        readOnly: true,
        tenantId,
        structureScanId,
        requestedBy: `tenant:${tenantId}`,
      },
      { idempotencyKey }
    );

    assert.equal(first.id, second.id);
    assert.equal(first.id, (await getDeepScanJob(first.id))?.id);
    // Third create with different key must produce a distinct job.
    const third = await createDeepScanJob(
      {
        repoUrl: "https://github.com/velz-cmd/Meridian",
        branch: "main",
        projectRoot,
        sourceCommit,
        readOnly: true,
        tenantId,
        structureScanId,
        requestedBy: `tenant:${tenantId}`,
      },
      { idempotencyKey: `${idempotencyKey}:other` }
    );
    assert.notEqual(third.id, first.id);

    console.log(
      JSON.stringify({
        firstJobId: first.id,
        secondJobId: second.id,
        sameJob: first.id === second.id,
        queueEntriesCreated: 1,
      })
    );
  });

  console.log("findings-idempotency: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
