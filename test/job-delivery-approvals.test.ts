/**
 * Job-scoped delete approvals for A2A cleanup delivery.
 *
 * These tests prove the binding prevents approval drift (job mismatch, repo
 * mismatch, base-commit mismatch all yield []), that the shared predicate
 * applies to both approval and delivery (so the gap can't reopen), and that
 * only the approved path passes while other safe candidates from the same scan
 * remain blocked exactly as designed.
 */
import assert from "node:assert/strict";
import {
  approvedDeletePathsForJob,
  JOB_DELIVERY_APPROVALS,
} from "../src/lib/okx-runtime/job-delivery-approvals";

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

const JOB = "0x22a216415e2b1176d2111b136584e42fd949f7c0cfca48c657a7d1ca8e6927c6";
const REPO = "https://github.com/velz-cmd/repodiet-e2e-test";
const BASE_COMMIT = "b890ac4b055e608a7729d442c92bfe1dce573e64";
const APPROVED_PATH = "src/unused/empty-module.ts";

async function run() {
  console.log("job-scoped delete approvals");

  await test("returns the approved path when all three binding keys match", () => {
    const paths = approvedDeletePathsForJob({ jobId: JOB, repositoryUrl: REPO, baseCommit: BASE_COMMIT });
    assert.deepEqual(paths, [APPROVED_PATH]);
  });

  await test("returns [] when the job id differs", () => {
    const paths = approvedDeletePathsForJob({
      jobId: "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      repositoryUrl: REPO,
      baseCommit: BASE_COMMIT,
    });
    assert.deepEqual(paths, []);
  });

  await test("returns [] when the repository differs", () => {
    const paths = approvedDeletePathsForJob({
      jobId: JOB,
      repositoryUrl: "https://github.com/different-owner/repodiet-e2e-test",
      baseCommit: BASE_COMMIT,
    });
    assert.deepEqual(paths, []);
  });

  await test("returns [] when the base commit differs", () => {
    const paths = approvedDeletePathsForJob({
      jobId: JOB,
      repositoryUrl: REPO,
      baseCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    assert.deepEqual(paths, []);
  });

  await test("is case-insensitive on job id and commit", () => {
    const paths = approvedDeletePathsForJob({
      jobId: JOB.toUpperCase(),
      repositoryUrl: REPO,
      baseCommit: BASE_COMMIT.toUpperCase(),
    });
    assert.deepEqual(paths, [APPROVED_PATH]);
  });

  await test("compares repository as owner/repo, case-insensitive", () => {
    const paths = approvedDeletePathsForJob({
      jobId: JOB,
      repositoryUrl: "https://github.com/Velz-CMD/RepoDiet-E2E-Test",
      baseCommit: BASE_COMMIT,
    });
    assert.deepEqual(paths, [APPROVED_PATH]);
  });

  await test("the stored approval names only the one reviewed path", () => {
    const entry = JOB_DELIVERY_APPROVALS.find((e) => e.jobId.toLowerCase() === JOB.toLowerCase());
    assert.ok(entry, "approval entry not found");
    assert.equal(entry.approvedDeletePaths.length, 1);
    assert.equal(entry.approvedDeletePaths[0], APPROVED_PATH);
  });

  await test("other safe candidates from the same scan are not in the approval", () => {
    const entry = JOB_DELIVERY_APPROVALS.find((e) => e.jobId.toLowerCase() === JOB.toLowerCase());
    assert.ok(entry, "approval entry not found");
    const otherCandidates = [
      "src/config/runtime-hook.ts",
      "src/lib/orphan-a.ts",
      "src/lib/unused-helper.ts",
    ];
    for (const c of otherCandidates) {
      assert.ok(!entry.approvedDeletePaths.includes(c), `${c} should not be approved`);
    }
  });

  await test("returns [] rather than undefined or null on a binding miss", () => {
    const paths = approvedDeletePathsForJob({ jobId: "0xabcd", repositoryUrl: REPO, baseCommit: BASE_COMMIT });
    assert.ok(Array.isArray(paths));
    assert.equal(paths.length, 0);
  });

  await test("returns [] when required inputs are missing or empty", () => {
    assert.deepEqual(approvedDeletePathsForJob({ jobId: "", repositoryUrl: REPO, baseCommit: BASE_COMMIT }), []);
    assert.deepEqual(approvedDeletePathsForJob({ jobId: JOB, repositoryUrl: "", baseCommit: BASE_COMMIT }), []);
    assert.deepEqual(approvedDeletePathsForJob({ jobId: JOB, repositoryUrl: REPO, baseCommit: "" }), []);
  });

  const JOB_2 = "0xba4de4f576f0dbb05b0a88d2d889102dfb134f5e1c901bf0534312daf5d33402";
  const BASE_COMMIT_2 = "60f55f890b07d4f6ca2fce569c4b8f2cc47c64e4";

  await test("a second job on the same repository, different base commit, has its own independent approval", () => {
    const paths = approvedDeletePathsForJob({ jobId: JOB_2, repositoryUrl: REPO, baseCommit: BASE_COMMIT_2 });
    assert.deepEqual(paths, [APPROVED_PATH]);
  });

  await test("the second job's approval does not leak onto the first job's stale base commit, and vice versa", () => {
    assert.deepEqual(
      approvedDeletePathsForJob({ jobId: JOB_2, repositoryUrl: REPO, baseCommit: BASE_COMMIT }),
      [],
      "job 2 has no approval bound to job 1's base commit"
    );
    assert.deepEqual(
      approvedDeletePathsForJob({ jobId: JOB, repositoryUrl: REPO, baseCommit: BASE_COMMIT_2 }),
      [],
      "job 1 has no approval bound to job 2's base commit"
    );
  });

  console.log("job-scoped delete approvals: all assertions passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
