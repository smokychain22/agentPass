import assert from "node:assert/strict";
import { withRefreshedVerificationGates } from "../src/lib/patch-kit/refresh-verification-gates";
import type { PatchKitPayload } from "../src/lib/patch-kit/types";

function basePatchKit(overrides?: Partial<PatchKitPayload>): PatchKitPayload {
  return {
    id: "patch_stale",
    scanId: "scan_stale",
    repo: { owner: "o", name: "r", branch: "main" },
    repositoryIsPublic: false,
    summary: {
      safeDeleteCandidates: 1,
      transformerCompatible: 1,
      dryRunPassed: 1,
      generatedChanges: 3,
      validatedChanges: 3,
      verifiedChanges: 3,
      filesEdited: 2,
      filesDeleted: 1,
      patchValidationStatus: "passed",
    },
    patchValidation: { status: "passed" },
    repositoryVerification: {
      status: "verified",
      installAttempts: [],
      checks: [{ name: "build", status: "passed" }],
      baseline: { checks: [{ name: "build", status: "passed" }] },
      patched: { checks: [{ name: "build", status: "passed" }] },
    },
    remediationPlan: {
      summary: { greenCount: 3, yellowCount: 0, redCount: 0, autoFixEligibleCount: 3 },
      green: [],
      yellow: [],
      red: [],
    },
    transformerResults: [],
    candidateAudits: [],
    artifacts: {
      reportMd: "",
      cleanupPatch: "",
      packageCleanupMd: "",
      regressionChecklistMd: "",
      cursorPromptMd: "",
      findingsJson: {
        summary: { totalFindings: 3 },
        scanIntelligence: { coverage: { readinessForFindings: true } },
        riskBuckets: { reviewFirst: [], doNotTouch: [], safeDelete: [] },
      } as unknown as PatchKitPayload["artifacts"]["findingsJson"],
      patchkitSummaryJson: "",
    },
    downloadUrl: "/api/patches/patch_stale/download",
    verificationGates: {
      gates: [
        {
          id: "verified_changes",
          label: "At least one verified cleanup change",
          requiredForSafePr: true,
          status: "failed",
          detail: "0 verified operations",
        },
      ],
      allRequiredPassed: false,
      passedCount: 0,
      failedCount: 1,
      skippedCount: 0,
    },
    ...overrides,
  } as PatchKitPayload;
}

const refreshed = withRefreshedVerificationGates(basePatchKit());
const verifiedGate = refreshed.verificationGates?.gates.find((g) => g.id === "verified_changes");

assert.equal(verifiedGate?.status, "passed");
assert.equal(refreshed.verificationGates?.allRequiredPassed, true);

console.log("refresh-verification-gates: all passed");
