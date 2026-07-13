import assert from "node:assert/strict";
import type { PatchKitPayload } from "../src/lib/patch-kit/types";
import {
  patchKitDeliveryBlocker,
  patchKitHasDeliverableChanges,
} from "../src/lib/a2a/patch-kit-delivery";

function basePatchKit(overrides?: Partial<PatchKitPayload>): PatchKitPayload {
  return {
    id: "patch_test",
    scanId: "scan_test",
    repo: { owner: "o", name: "r", branch: "main" },
    repositoryIsPublic: false,
    summary: {
      safeDeleteCandidates: 1,
      transformerCompatible: 1,
      dryRunPassed: 1,
      generatedChanges: 0,
      validatedChanges: 0,
      verifiedChanges: 0,
      filesEdited: 0,
      filesDeleted: 0,
      patchValidationStatus: "not_run",
    },
    patchValidation: { status: "not_generated" },
    transformerResults: [],
    candidateAudits: [],
    artifacts: {
      reportMd: "",
      cleanupPatch: "",
      packageCleanupMd: "",
      regressionChecklistMd: "",
      cursorPromptMd: "",
      findingsJson: {} as PatchKitPayload["artifacts"]["findingsJson"],
      patchkitSummaryJson: "",
    },
    downloadUrl: "/api/patches/patch_test/download",
    ...overrides,
  } as PatchKitPayload;
}

assert.equal(patchKitHasDeliverableChanges(basePatchKit()), false);
assert.equal(
  patchKitHasDeliverableChanges(
    basePatchKit({
      summary: {
        ...basePatchKit().summary,
        verifiedChanges: 2,
      },
      patchValidation: { status: "passed" },
    })
  ),
  true
);
assert.match(
  patchKitDeliveryBlocker(basePatchKit()) ?? "",
  /No cleanup changes were generated/i
);

console.log("patch-kit-delivery: all passed");
