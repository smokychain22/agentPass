import test from "node:test";
import assert from "node:assert/strict";
import { computeWorkflowGates } from "../src/lib/workflow/gates";
import type { FindingsPayload } from "../src/lib/findings/types";
import type { PatchKitPayload } from "../src/lib/patch-kit/types";

function minimalFindings(overrides?: Partial<FindingsPayload>): FindingsPayload {
  return {
    scanId: "scan_test",
    mode: "live",
    repo: { owner: "o", name: "r", branch: "main" },
    summary: {
      totalFindings: 1,
      duplicateClusters: 0,
      unusedFiles: 0,
      unusedDependencies: 0,
      unusedExports: 0,
      orphanPatterns: 0,
      slopSignals: 0,
      reviewRequired: 0,
      safeCandidates: 0,
      actionableFixes: 1,
      transformerCompatible: 1,
      dryRunPassed: 1,
      doNotTouch: 0,
    },
    duplicates: [],
    unused: { files: [], dependencies: [], exports: [] },
    orphans: [],
    slopSignals: [],
    rawToolReports: {
      knip: { status: "ok", source: "knip", sourceMode: "native", durationMs: 1 },
      jscpd: { status: "ok", source: "jscpd", sourceMode: "native", durationMs: 1 },
      madge: { status: "ok", source: "madge", sourceMode: "native", durationMs: 1 },
    },
    ...overrides,
  } as FindingsPayload;
}

function minimalPatchKit(overrides?: Partial<PatchKitPayload>): PatchKitPayload {
  return {
    id: "patch_test",
    scanId: "scan_test",
    repo: { owner: "o", name: "r", branch: "main" },
    summary: {
      safeDeleteCandidates: 0,
      transformerCompatible: 1,
      dryRunPassed: 1,
      generatedChanges: 1,
      validatedChanges: 1,
      verifiedChanges: 1,
      filesEdited: 1,
      filesDeleted: 0,
      filesAdded: 0,
      supportedFixesDetected: 1,
      rawReviewFindings: 0,
      reviewFirstItems: 0,
      doNotTouchItems: 0,
      packageSuggestions: 0,
      patchLines: 10,
      regressionChecks: 0,
      bundleFileCount: 5,
    },
    patchValidation: { status: "passed" },
    artifacts: {
      reportMd: "# report",
      cleanupPatch: "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n",
      packageCleanupMd: "",
      regressionChecklistMd: "",
      cursorPromptMd: "",
      findingsJson: minimalFindings(),
      patchkitSummaryJson: "{}",
    },
    downloadUrl: "/api/patches/patch_test/download",
    ...overrides,
  };
}

test("computeWorkflowGates locks quick cleanup without transformer-compatible findings", () => {
  const gates = computeWorkflowGates({
    scanComplete: true,
    projectRootConfirmed: true,
    findings: minimalFindings({
      summary: {
        totalFindings: 2,
        duplicateClusters: 0,
        unusedFiles: 0,
        unusedDependencies: 0,
        unusedExports: 0,
        orphanPatterns: 0,
        slopSignals: 0,
        reviewRequired: 2,
        safeCandidates: 0,
        actionableFixes: 0,
        transformerCompatible: 0,
        dryRunPassed: 0,
        doNotTouch: 0,
      },
    }),
    patchKit: null,
  });
  assert.equal(gates.quickCleanupAvailable, false);
  assert.equal(gates.verifyUnlocked, false);
});

test("computeWorkflowGates unlocks verify when patch validated with changes", () => {
  const gates = computeWorkflowGates({
    scanComplete: true,
    projectRootConfirmed: true,
    findings: minimalFindings({
      unused: {
        files: [],
        dependencies: [],
        exports: [
          {
            id: "f1",
            type: "unused_import",
            title: "Unused import",
            files: ["src/a.ts"],
            confidence: 0.95,
            confidenceReason: "test",
            severity: "low",
            action: "safe_candidate",
            source: "knip",
            sourceMode: "native",
            reason: "test",
            evidence: {
              summary: "x",
              signals: [
                "symbol=unusedFoo",
                "importLine=import { unusedFoo } from \"./helpers\";",
                "line=1",
                "classification=actionable_candidate",
              ],
            },
          },
        ],
      },
      riskBuckets: { safeDelete: ["f1"], reviewFirst: [], doNotTouch: [] },
    }),
    patchKit: minimalPatchKit(),
    selectedFindingIds: ["f1"],
    commitSha: "abc",
    githubStatus: {
      connected: true,
      configured: true,
      repository: "o/r",
      owner: "o",
      canRead: true,
      canCreateBranch: true,
      canCreatePullRequest: true,
    },
  });
  assert.equal(gates.quickCleanupAvailable, true);
  assert.equal(gates.verifyUnlocked, true);
  assert.equal(gates.cleanupPrAvailable, false);
  assert.equal(gates.quickCleanupState, "complete");
});

test("computeWorkflowGates unlocks cleanup PR only after verification passes", () => {
  const gates = computeWorkflowGates({
    scanComplete: true,
    projectRootConfirmed: true,
    findings: minimalFindings(),
    patchKit: minimalPatchKit(),
    verificationStatus: "passed",
  });
  assert.equal(gates.cleanupPrAvailable, true);
  assert.equal(gates.verificationPassed, true);
});

test("computeWorkflowGates blocks verify when patch validation failed", () => {
  const gates = computeWorkflowGates({
    scanComplete: true,
    projectRootConfirmed: true,
    findings: minimalFindings(),
    patchKit: minimalPatchKit({
      patchValidation: { status: "failed", error: "apply failed" },
      summary: {
        ...minimalPatchKit().summary,
        validatedChanges: 0,
        verifiedChanges: 0,
        generatedChanges: 0,
      },
    }),
  });
  assert.equal(gates.verifyUnlocked, false);
  assert.equal(gates.cleanupPrAvailable, false);
});
