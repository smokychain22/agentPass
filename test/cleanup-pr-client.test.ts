import assert from "node:assert/strict";
import { parseCreateCleanupPrResponse } from "../src/lib/patch-kit/client";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("cleanup-pr-client");

test("parses legacy ok response shape", () => {
  const result = parseCreateCleanupPrResponse({
    ok: true,
    pullRequest: { url: "https://github.com/o/r/pull/1", number: 1, title: "t" },
    actionSummary: {
      mode: "safe_only",
      filesDeleted: 1,
      artifactsAdded: 5,
      safeCandidatesApplied: 2,
      reviewFirstSkipped: 0,
      doNotTouchSkipped: 0,
    },
    repo: {
      owner: "o",
      name: "r",
      baseBranch: "main",
      cleanupBranch: "repodiet/cleanup-abc",
    },
  });
  assert.equal(result.pullRequest.number, 1);
  assert.equal(result.repo.cleanupBranch, "repodiet/cleanup-abc");
});

test("parses Phase3 success/result response shape", () => {
  const result = parseCreateCleanupPrResponse({
    success: true,
    taskId: "task_1",
    result: {
      pullRequest: { url: "https://github.com/o/r/pull/14", number: 14, title: "RepoDiet" },
      actionSummary: {
        mode: "safe_only",
        filesDeleted: 0,
        artifactsAdded: 5,
        safeCandidatesApplied: 3,
        reviewFirstSkipped: 2,
        doNotTouchSkipped: 1,
      },
      repo: {
        owner: "o",
        name: "r",
        baseBranch: "main",
        cleanupBranch: "repodiet/cleanup-x",
      },
    },
  });
  assert.equal(result.pullRequest.number, 14);
  assert.equal(result.actionSummary.safeCandidatesApplied, 3);
});

test("rejects missing pull request", () => {
  assert.throws(
    () =>
      parseCreateCleanupPrResponse({
        success: true,
        result: {},
        error: { code: "X", message: "failed" },
      }),
    /failed/
  );
});

console.log("cleanup-pr-client: all passed");
