import assert from "node:assert/strict";
import { buildCleanupRunSummary } from "../src/lib/patch-kit/cleanup-summary";
import type { ChangeOperation } from "../src/lib/patch-kit/canonical-patch";

function testGitValidatedRequiresPassedPatchStatus(): void {
  const ops: ChangeOperation[] = [
    {
      id: "1",
      findingIds: ["f1"],
      transformerId: "t",
      type: "edit",
      filePath: "src/a.ts",
      baseBlobSha: null,
      baseContentHash: null,
      beforeContent: "a",
      afterContent: "b",
      linesAdded: 1,
      linesRemoved: 0,
    },
    {
      id: "2",
      findingIds: ["f2"],
      transformerId: "t",
      type: "delete",
      filePath: "src/b.ts",
      baseBlobSha: null,
      baseContentHash: null,
      beforeContent: "x",
      afterContent: null,
      linesAdded: 0,
      linesRemoved: 1,
    },
    {
      id: "3",
      findingIds: ["f3"],
      transformerId: "t",
      type: "delete",
      filePath: "src/c.ts",
      baseBlobSha: null,
      baseContentHash: null,
      beforeContent: "y",
      afterContent: null,
      linesAdded: 0,
      linesRemoved: 1,
    },
  ];

  const pending = buildCleanupRunSummary({
    findings: { summary: {}, riskBuckets: { reviewFirst: [], doNotTouch: [], safeDelete: [] } } as never,
    summary: { patchValidationStatus: "pending_sandbox" } as never,
    changeOperations: ops,
    verification: { status: "not_run", installAttempts: [], checks: [] },
    patchValidationStatus: "pending_sandbox",
  });

  const passed = buildCleanupRunSummary({
    findings: { summary: {}, riskBuckets: { reviewFirst: [], doNotTouch: [], safeDelete: [] } } as never,
    summary: { patchValidationStatus: "pending_sandbox" } as never,
    changeOperations: ops,
    verification: { status: "verified", installAttempts: [], checks: [] },
    patchValidationStatus: "passed",
  });

  assert.equal(pending.gitValidatedOperations, 0);
  assert.equal(pending.contentValidatedOperations, 3);
  assert.equal(passed.gitValidatedOperations, 3);
  assert.equal(passed.verifiedOperations, 3);
}

function testIsTerminalSandboxStatus(): void {
  const { isTerminalSandboxStatus } = require("../src/lib/execution/start-cleanup-workflow") as typeof import("../src/lib/execution/start-cleanup-workflow");
  assert.equal(isTerminalSandboxStatus("ready_for_delivery"), true);
  assert.equal(isTerminalSandboxStatus("starting"), false);
}

testGitValidatedRequiresPassedPatchStatus();
testIsTerminalSandboxStatus();
console.log("sandbox-persist.test.ts: ok");
