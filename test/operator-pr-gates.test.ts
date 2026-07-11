import assert from "node:assert/strict";
import { computeOperatorPrGates } from "../src/lib/patch-kit/operator-pr-gates";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("operator-pr-gates");

test("enables cleanup PR when repo authorized with verified changes", () => {
  const gates = computeOperatorPrGates({
    locked: false,
    statusLoading: false,
    preflightLoading: false,
    repositoryAuthorized: true,
    permissionsVerified: true,
    canCreateBranch: true,
    canCreatePullRequest: true,
    useDemoAuth: false,
    manualTokenReady: false,
    patchValidated: true,
    generatedChanges: 22,
    validatedChanges: 22,
    verifiedChanges: 22,
    validatedEditCount: 22,
    safeDeleteCount: 0,
    requireVerificationForCleanupPr: true,
    verificationStatus: "verified",
  });
  assert.equal(gates.canCreateSafePr, true);
  assert.equal(gates.canCreateReportPr, true);
});

test("blocks cleanup PR when patch validated but not verified", () => {
  const gates = computeOperatorPrGates({
    locked: false,
    statusLoading: false,
    preflightLoading: false,
    repositoryAuthorized: true,
    permissionsVerified: true,
    canCreateBranch: true,
    canCreatePullRequest: true,
    useDemoAuth: false,
    manualTokenReady: false,
    patchValidated: true,
    generatedChanges: 2,
    validatedChanges: 2,
    verifiedChanges: 0,
    validatedEditCount: 2,
    safeDeleteCount: 0,
    requireVerificationForCleanupPr: true,
    verificationStatus: "blocked",
  });
  assert.equal(gates.canCreateSafePr, false);
});

test("blocks cleanup PR while preflight is loading", () => {
  const gates = computeOperatorPrGates({
    locked: false,
    statusLoading: false,
    preflightLoading: true,
    repositoryAuthorized: true,
    permissionsVerified: true,
    canCreateBranch: true,
    canCreatePullRequest: true,
    useDemoAuth: false,
    manualTokenReady: false,
    patchValidated: true,
    generatedChanges: 22,
    validatedChanges: 22,
    verifiedChanges: 22,
    validatedEditCount: 22,
    safeDeleteCount: 0,
    requireVerificationForCleanupPr: true,
    verificationStatus: "verified",
  });
  assert.equal(gates.canCreateSafePr, false);
});

test("allows report-only PR without validated changes when authorized", () => {
  const gates = computeOperatorPrGates({
    locked: false,
    statusLoading: false,
    preflightLoading: false,
    repositoryAuthorized: true,
    permissionsVerified: true,
    canCreateBranch: true,
    canCreatePullRequest: true,
    useDemoAuth: false,
    manualTokenReady: false,
    patchValidated: false,
    generatedChanges: 0,
    validatedChanges: 0,
    verifiedChanges: 0,
    validatedEditCount: 0,
    safeDeleteCount: 0,
    requireVerificationForCleanupPr: true,
    verificationStatus: null,
  });
  assert.equal(gates.canCreateReportPr, true);
  assert.equal(gates.canCreateSafePr, false);
});

console.log("operator-pr-gates: all passed");
