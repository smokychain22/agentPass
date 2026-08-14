import assert from "node:assert/strict";

/**
 * PR A — server-side sandbox model, authoritative worker-result verification.
 *
 * The sandbox validate job (a future GitHub Actions worker, secretless and
 * touching the untrusted customer repo) reports a raw result back to this
 * server. This suite pins that the server NEVER records that report at face
 * value: it independently re-derives pass/fail from the run's own dispatched
 * payload (pinned base commit, exact expected changed paths), and that
 * completion is idempotent-safe — a replayed identical result is a no-op, a
 * contradictory one on an already-terminal run is refused, and a stale claim
 * (superseded by a reclaim) can never complete a run.
 */

process.env.UPSTASH_REDIS_REST_URL = "";
process.env.UPSTASH_REDIS_REST_TOKEN = "";

import {
  claimSandboxRun,
  createSandboxRun,
  getSandboxRun,
  updateSandboxRun,
} from "../src/lib/execution/sandbox-run-store";
import {
  completeSandboxRunFromWorker,
  verifySandboxWorkerResult,
  type SandboxWorkerReport,
} from "../src/lib/execution/sandbox-run-verification";
import type { SandboxRun, SandboxRunPayload } from "../src/lib/execution/sandbox-run-types";

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

const BASE_SHA = "5df7c518abc0000000000000000000000000000";

let seq = 0;
function fixturePayload(): SandboxRunPayload {
  seq += 1;
  return {
    cleanupRunId: `cleanup_run_verify_${Date.now()}_${seq}`,
    repositoryOwner: "velz-cmd",
    repositoryName: "repodiet-e2e-test",
    branch: "main",
    baseCommitSha: BASE_SHA,
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

function passingReport(overrides: Partial<SandboxWorkerReport> = {}): SandboxWorkerReport {
  return {
    status: "passed",
    baseCommitSha: BASE_SHA,
    validatedPaths: ["unused-file.ts"],
    gitApplyExitCode: 0,
    patchHash: "deadbeef",
    repositoryVerification: { status: "verified", installAttempts: [], checks: [] },
    ...overrides,
  };
}

async function claimedRun(workerId = "github-actions/ubuntu-latest"): Promise<{ run: SandboxRun; claimToken: string }> {
  const run = await createSandboxRun(fixturePayload());
  const claim = await claimSandboxRun(run.id, workerId);
  assert.ok(claim.ok);
  if (!claim.ok) throw new Error("unreachable");
  return { run: claim.run, claimToken: claim.run.claimToken! };
}

console.log("Sandbox run authoritative worker-result verification");

async function main() {
  await test("pure verify: happy path yields a passed CanonicalPatchValidationResult", async () => {
    const { run } = await claimedRun();
    const outcome = verifySandboxWorkerResult(run, passingReport());
    assert.ok(outcome.ok);
    if (!outcome.ok) return;
    assert.equal(outcome.verifiedChanges, 1);
    assert.deepEqual(outcome.verifiedPaths, ["unused-file.ts"]);
    assert.equal(outcome.patchValidation.status, "passed");
    assert.equal(outcome.repositoryVerification.status, "verified");
  });

  await test("pure verify: a missing repositoryVerification on the report defaults to not_run, not a silent pass", async () => {
    const { run } = await claimedRun();
    const outcome = verifySandboxWorkerResult(run, passingReport({ repositoryVerification: undefined }));
    assert.ok(outcome.ok, "patch validity itself is still fine");
    if (!outcome.ok) return;
    assert.equal(outcome.repositoryVerification.status, "not_run");
  });

  await test("completeSandboxRunFromWorker: a valid patch whose repository verification did NOT pass is blocked, not ready_for_delivery", async () => {
    const { run, claimToken } = await claimedRun();
    const result = await completeSandboxRunFromWorker(
      run.id,
      "github-actions/ubuntu-latest",
      claimToken,
      passingReport({ repositoryVerification: { status: "failed", installAttempts: [], checks: [] } })
    );
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.run.status, "blocked", "a valid patch with a failing build/test must not become deliverable");
    assert.equal(result.run.verifiedChanges, 1, "patch validity itself is still recorded");
  });

  await test("pure verify: a wrong base commit is rejected, never passed", async () => {
    const { run } = await claimedRun();
    const outcome = verifySandboxWorkerResult(run, passingReport({ baseCommitSha: "0000000000000000000000000000000000dead" }));
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.failureCode, "BASE_COMMIT_MISMATCH");
  });

  await test("pure verify: a nonzero git apply exit code is rejected", async () => {
    const { run } = await claimedRun();
    const outcome = verifySandboxWorkerResult(run, passingReport({ gitApplyExitCode: 1, gitApplyStderr: "patch does not apply" }));
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.failureCode, "GIT_APPLY_FAILED");
  });

  await test("pure verify: an unexpected changed path is rejected — a worker cannot smuggle in extra changes", async () => {
    const { run } = await claimedRun();
    const outcome = verifySandboxWorkerResult(run, passingReport({ validatedPaths: ["unused-file.ts", "sneaky.ts"] }));
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.failureCode, "UNEXPECTED_CHANGED_PATH");
  });

  await test("pure verify: a missing expected changed path is rejected", async () => {
    const { run } = await claimedRun();
    const outcome = verifySandboxWorkerResult(run, passingReport({ validatedPaths: [] }));
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.failureCode, "MISSING_CHANGED_PATH");
  });

  await test("pure verify: a worker-reported failure is honored as a failure", async () => {
    const { run } = await claimedRun();
    const outcome = verifySandboxWorkerResult(run, { status: "failed", baseCommitSha: BASE_SHA, error: "clone failed" });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.failureCode, "WORKER_REPORTED_FAILURE");
  });

  await test("completeSandboxRunFromWorker rejects a wrong claimToken and leaves the run non-terminal", async () => {
    const { run } = await claimedRun();
    const result = await completeSandboxRunFromWorker(run.id, "github-actions/ubuntu-latest", "not-the-real-token", passingReport());
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "CLAIM_MISMATCH");

    const fresh = await getSandboxRun(run.id);
    assert.notEqual(fresh?.status, "ready_for_delivery");
  });

  await test("completeSandboxRunFromWorker: a verified passing report marks ready_for_delivery and clears the claim", async () => {
    const { run, claimToken } = await claimedRun();
    const result = await completeSandboxRunFromWorker(run.id, "github-actions/ubuntu-latest", claimToken, passingReport());
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.idempotent, false);
    assert.equal(result.run.status, "ready_for_delivery");
    assert.equal(result.run.verifiedChanges, 1);
    assert.deepEqual(result.run.verifiedPaths, ["unused-file.ts"]);
    assert.equal(result.run.claimToken, undefined, "claim token must be invalidated after completion");
  });

  await test("completeSandboxRunFromWorker: an identical replayed completion is idempotent, not an error", async () => {
    const { run, claimToken } = await claimedRun();
    const first = await completeSandboxRunFromWorker(run.id, "github-actions/ubuntu-latest", claimToken, passingReport());
    assert.ok(first.ok);

    // Same worker report replayed (e.g. worker retried after a dropped response).
    const second = await completeSandboxRunFromWorker(run.id, "github-actions/ubuntu-latest", claimToken, passingReport());
    assert.ok(second.ok);
    if (!second.ok) return;
    assert.equal(second.idempotent, true);
    assert.equal(second.run.status, "ready_for_delivery");
  });

  await test("completeSandboxRunFromWorker: a contradictory result on an already-terminal run is refused, not silently overwritten", async () => {
    const { run, claimToken } = await claimedRun();
    const first = await completeSandboxRunFromWorker(run.id, "github-actions/ubuntu-latest", claimToken, passingReport());
    assert.ok(first.ok);

    // A different (contradictory) report for the same run — must be rejected, and the
    // original verified paths must remain exactly as first recorded.
    const conflicting = await completeSandboxRunFromWorker(
      run.id,
      "github-actions/ubuntu-latest",
      claimToken,
      passingReport({ validatedPaths: ["unused-file.ts", "some-other-file.ts"] })
    );
    assert.equal(conflicting.ok, false);
    if (conflicting.ok) return;
    assert.equal(conflicting.code, "SANDBOX_RESULT_CONFLICT");

    const fresh = await getSandboxRun(run.id);
    assert.deepEqual(fresh?.verifiedPaths, ["unused-file.ts"], "original verified result must be unchanged");
  });

  await test("completeSandboxRunFromWorker: a genuine failure report marks the run failed with the derived failure code", async () => {
    const { run, claimToken } = await claimedRun();
    const result = await completeSandboxRunFromWorker(
      run.id,
      "github-actions/ubuntu-latest",
      claimToken,
      passingReport({ gitApplyExitCode: 1, gitApplyStderr: "patch rejected" })
    );
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.run.status, "failed");
    assert.equal(result.run.failureCode, "GIT_APPLY_FAILED");
    assert.equal(result.run.claimToken, undefined, "claim token must be invalidated after a terminal failure too");
  });

  await test("a late completion using a superseded claim token (after reclaim) can never mark the run passed", async () => {
    const { run, claimToken: staleToken } = await claimedRun("worker-a");

    // Lease expires; a different worker reclaims and gets a fresh token.
    await updateSandboxRun(run.id, { leaseExpiresAt: new Date(Date.now() - 1000).toISOString() });
    const reclaim = await claimSandboxRun(run.id, "worker-b");
    assert.ok(reclaim.ok);
    if (!reclaim.ok) return;
    assert.notEqual(reclaim.run.claimToken, staleToken);

    // The original (superseded) worker's late result must be rejected.
    const late = await completeSandboxRunFromWorker(run.id, "worker-a", staleToken, passingReport());
    assert.equal(late.ok, false);
    if (late.ok) return;
    assert.equal(late.code, "CLAIM_MISMATCH");

    const fresh = await getSandboxRun(run.id);
    assert.notEqual(fresh?.status, "ready_for_delivery", "a stale-claim completion must never mark the run passed");
  });

  console.log("Sandbox run authoritative worker-result verification: all passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
