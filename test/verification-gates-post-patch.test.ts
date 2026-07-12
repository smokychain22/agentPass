import assert from "node:assert/strict";
import { buildVerificationGateReport } from "../src/lib/patch-kit/verification-gates";
import type { PatchKitPayload } from "../src/lib/patch-kit/types";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

function basePatchKit(overrides: Partial<PatchKitPayload> = {}): PatchKitPayload {
  return {
    id: "pk1",
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
      rawReviewFindings: 0,
      reviewFirstItems: 0,
      doNotTouchItems: 0,
      packageSuggestions: 0,
      patchLines: 10,
      regressionChecks: 1,
      bundleFileCount: 7,
    },
    artifacts: {} as PatchKitPayload["artifacts"],
    downloadUrl: "/api/patches/pk1/download",
    patchValidation: { status: "passed" },
    repositoryVerification: { status: "verified", installAttempts: [], checks: [] },
    ...overrides,
  };
}

console.log("verification-gates-post-patch");

test("detector_rerun and no_new_findings required when post-patch ran", () => {
  const report = buildVerificationGateReport(
    basePatchKit({
      postPatchVerification: {
        status: "passed",
        detectorReruns: [{ findingId: "f1", analyzer: "knip", passed: true, detail: "ok" }],
        originalFindingsResolved: true,
        newFindingsIntroduced: [],
        newFindingCount: 0,
        baselineFindingCount: 5,
        patchedFindingCount: 4,
      },
    })
  );
  const detector = report.gates.find((g) => g.id === "detector_rerun");
  const noNew = report.gates.find((g) => g.id === "no_new_findings");
  assert.equal(detector?.requiredForSafePr, true);
  assert.equal(detector?.status, "passed");
  assert.equal(noNew?.requiredForSafePr, true);
  assert.equal(noNew?.status, "passed");
});

test("api_surface gate fails on breaking export removal", () => {
  const report = buildVerificationGateReport(
    basePatchKit({
      apiSurfaceDiff: {
        before: { exports: ["./index"], bin: [] },
        after: { exports: [], bin: [] },
        removedExports: ["./index"],
        addedExports: [],
        breaking: true,
      },
    })
  );
  const gate = report.gates.find((g) => g.id === "api_surface");
  assert.equal(gate?.status, "failed");
});

console.log("verification-gates-post-patch: all passed");
