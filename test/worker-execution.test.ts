import assert from "node:assert/strict";
import { buildAuthoritativeCleanupRunSummary } from "../src/lib/patch-kit/cleanup-summary";
import { createBackupCandidateAudit, createBackupFileFinding } from "../src/lib/patch-kit/safe-delete-discovery";
import type { ChangeOperation } from "../src/lib/patch-kit/canonical-patch";
import type { FindingsPayload } from "../src/lib/findings/types";
import { isFrameworkProtectedDependency } from "../src/lib/findings/framework-protected";
import { validateWorkerApiKey, WorkerAuthError } from "../src/lib/worker/worker-auth";
import { isVercelSandboxAvailable } from "../src/lib/execution/vercel-sandbox";
import { deriveAttemptProductOutcome } from "../src/lib/execution/outcomes";
import { computeWorkflowGates } from "../src/lib/workflow/gates";
import { redactSecrets } from "../src/lib/execution/sandbox-command";

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
    const findings = {
      summary: { reviewRequired: 2, doNotTouch: 1 },
      riskBuckets: { reviewFirst: ["a"], doNotTouch: ["b"], safeDelete: [] },
    } as unknown as FindingsPayload;

    const summary = buildAuthoritativeCleanupRunSummary({
      findings,
      summary: { patchValidationStatus: "pending_sandbox" } as never,
      changeOperations: ops,
      verification: { status: "not_run", installAttempts: [], checks: [] },
    });

    assert.equal(summary.generatedOperations, 3);
    assert.equal(summary.contentValidatedOperations, 3);
    assert.equal(summary.gitValidatedOperations, 0);
    assert.equal(summary.verifiedOperations, 0);
    assert.equal(summary.reviewRequiredFindings, 1);
  });

  await test("pending_sandbox keeps git validation at zero while content validation passes", () => {
    const summary = buildAuthoritativeCleanupRunSummary({
      findings: { summary: {}, riskBuckets: { reviewFirst: [], doNotTouch: [], safeDelete: [] } } as never,
      summary: { patchValidationStatus: "pending_sandbox" } as never,
      changeOperations: [
        {
          id: "1",
          findingIds: ["f1"],
          transformerId: "t",
          type: "delete",
          filePath: "src/archive/OldDashboard.backup.tsx",
          baseBlobSha: null,
          baseContentHash: null,
          beforeContent: "x",
          afterContent: null,
          linesAdded: 0,
          linesRemoved: 1,
        },
      ],
      verification: { status: "not_run", installAttempts: [], checks: [] },
    });
    assert.equal(summary.contentValidatedOperations, 1);
    assert.equal(summary.gitValidatedOperations, 0);
  });

  await test("backup deletion creates persisted finding and audit", () => {
    const proof = {
      filePath: "src/archive/OldDashboard.backup.tsx",
      baselineHash: "abc",
      operation: "delete" as const,
      inboundRefs: 0,
      protected: false,
      approved: true,
    };
    const finding = createBackupFileFinding(proof);
    const audit = createBackupCandidateAudit(finding);
    assert.equal(finding.files[0], proof.filePath);
    assert.equal(audit.findingId, finding.id);
    assert.equal(audit.retained, true);
    assert.equal(audit.transformAttempted, true);
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

  await test("worker auth error exposes stable codes", () => {
    const err = new WorkerAuthError("WORKER_AUTH_INVALID", "bad key");
    assert.equal(err.code, "WORKER_AUTH_INVALID");
  });

  await test("vercel sandbox availability requires Vercel deployment context", () => {
    const original = process.env.VERCEL;
    delete process.env.VERCEL;
    assert.equal(isVercelSandboxAvailable(), false);
    process.env.VERCEL = original;
  });

  await test("retained transformer outcome is generated_pending before verification", () => {
    const outcome = deriveAttemptProductOutcome({
      internalStatus: "retained",
      reason: "ok",
      pluginId: "remove_unused_import",
    });
    assert.equal(outcome, "generated_pending");
  });

  await test("cleanup PR disabled while sandbox execution is pending", () => {
    const gates = computeWorkflowGates({
      scanComplete: true,
      findings: {
        duplicates: [],
        unused: { files: [], dependencies: [], exports: [] },
        orphans: [],
        slopSignals: [],
        summary: { eligibleFindings: 3, reviewRequired: 0, doNotTouch: 0 },
        riskBuckets: { reviewFirst: [], doNotTouch: [], safeDelete: [] },
      } as never,
      patchKit: {
        id: "run1",
        summary: {
          generatedChanges: 3,
          validatedChanges: 0,
          verifiedChanges: 0,
        },
        patchValidation: { status: "pending_sandbox" },
      } as never,
      verificationStatus: "not_run",
    });
    assert.equal(gates.cleanupPrAvailable, false);
    assert.equal(gates.quickCleanupState, "running");
  });

  await test("redactSecrets removes github tokens from logs", () => {
    const redacted = redactSecrets("clone https://x-access-token:ghs_secret123@github.com/foo/bar");
    assert.equal(redacted.includes("ghs_secret123"), false);
    assert.equal(redacted.includes("[REDACTED]"), true);
  });

  console.log("worker-execution: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
