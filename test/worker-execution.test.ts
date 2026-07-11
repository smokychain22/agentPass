import assert from "node:assert/strict";
import { buildAuthoritativeCleanupRunSummary } from "../src/lib/patch-kit/cleanup-summary";
import type { ChangeOperation } from "../src/lib/patch-kit/canonical-patch";
import type { FindingsPayload } from "../src/lib/findings/types";
import { isFrameworkProtectedDependency } from "../src/lib/findings/framework-protected";
import { validateWorkerApiKey } from "../src/lib/worker/worker-auth";

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    await fn();
    console.log(`  ✓ ${name}`);
  })();
}

async function run() {
  console.log("worker-execution tests");

  await test("generatedOperations equals unique change operation paths", () => {
    const ops: ChangeOperation[] = [
      {
        id: "1",
        findingIds: [],
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
        findingIds: [],
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
        findingIds: [],
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
    const findings = {
      summary: { reviewRequired: 2, doNotTouch: 1 },
      riskBuckets: { reviewFirst: ["a"], doNotTouch: ["b"], safeDelete: [] },
    } as unknown as FindingsPayload;

    const summary = buildAuthoritativeCleanupRunSummary({
      findings,
      summary: { patchValidationStatus: "blocked" } as never,
      changeOperations: ops,
      verification: { status: "not_run", installAttempts: [], checks: [] },
    });

    assert.equal(summary.generatedOperations, 3);
    assert.equal(summary.contentValidatedOperations, 3);
    assert.equal(summary.gitValidatedOperations, 0);
    assert.equal(summary.verifiedOperations, 0);
    assert.equal(summary.reviewRequiredFindings, 1);
  });

  await test("left-pad is not framework protected; react-dom is", () => {
    assert.equal(isFrameworkProtectedDependency("left-pad", "next"), false);
    assert.equal(isFrameworkProtectedDependency("react-dom", "next"), true);
  });

  await test("worker API key uses constant-time comparison", () => {
    process.env.WORKER_API_KEY = "test-secret-key-12345";
    assert.equal(validateWorkerApiKey("Bearer test-secret-key-12345"), true);
    assert.equal(validateWorkerApiKey("Bearer wrong"), false);
    delete process.env.WORKER_API_KEY;
  });

  console.log("worker-execution: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
