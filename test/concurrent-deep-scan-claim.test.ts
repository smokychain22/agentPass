import assert from "node:assert/strict";
import {
  createDeepScanJob,
  claimNextDeepScanJob,
  getDeepScanJob,
} from "../src/lib/deep-scan/job-store";
import { enqueueDeepScanAtomic } from "../src/lib/deep-scan/atomic-queue";
import { repositoryTargetFromKnown } from "../src/lib/repository/repository-target";

function test(name: string, fn: () => Promise<void>) {
  return (async () => {
    await fn();
    console.log(`  ✓ ${name}`);
  })();
}

async function run() {
  console.log("concurrent-deep-scan-claim");

  await test("two concurrent claimNext calls: only one wins the same job id", async () => {
    process.env.REPODIET_TEST_OFFLINE = "1";
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const unique = `race_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const repositoryTarget = repositoryTargetFromKnown({
      owner: "acme",
      name: "widgets",
      branch: "main",
      sourceCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      projectRoot: ".",
    });
    const job = await createDeepScanJob(
      {
        repoUrl: repositoryTarget.repositoryUrl,
        branch: "main",
        projectRoot: ".",
        sourceCommit: repositoryTarget.sourceCommit,
        readOnly: true,
        tenantId: `okx_${unique}`,
        requestedBy: `tenant:okx_${unique}`,
      },
      { idempotencyKey: `claim-race-${unique}`, repositoryTarget }
    );

    // Ensure this job id is the next dequeued item.
    await enqueueDeepScanAtomic(job.id);

    const [a, b] = await Promise.all([
      claimNextDeepScanJob(`worker_a_${unique}`),
      claimNextDeepScanJob(`worker_b_${unique}`),
    ]);

    const hits = [a, b].filter((j) => j?.id === job.id);
    assert.equal(hits.length, 1, `expected exactly one claim of ${job.id}, got ${hits.length}`);
    const claimed = hits[0]!;
    assert.ok(claimed.claimToken);
    assert.equal(claimed.stage, "CLAIMED");

    const persisted = await getDeepScanJob(job.id);
    assert.equal(persisted?.claimedBy, claimed.claimedBy);
    assert.equal(persisted?.claimToken, claimed.claimToken);

    const third = await claimNextDeepScanJob(`worker_c_${unique}`);
    if (third?.id === job.id) {
      assert.fail("leased job was claimed a second time");
    }
  });

  console.log("concurrent-deep-scan-claim: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
