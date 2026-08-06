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

interface PhaseCheck {
  name: string;
  command?: string;
  status: string;
  exitCode?: number | null;
  durationMs?: number;
  stdoutSummary?: string;
  stderrSummary?: string;
}

const TEST_FAILURE = {
  name: "test",
  command: "npm run test",
  status: "failed",
  exitCode: 1,
  durationMs: 1200,
  stdoutSummary: "1 failing\n  legacy suite > renders old panel",
  stderrSummary: "AssertionError: expected 3 to equal 4",
};

const TEST_PASS = {
  name: "test",
  command: "npm run test",
  status: "passed",
  exitCode: 0,
  durationMs: 1100,
  stdoutSummary: "12 passing",
  stderrSummary: "",
};

const TYPECHECK_PASS = { name: "typecheck", command: "tsc --noEmit", status: "passed", exitCode: 0, durationMs: 800 };
const BUILD_PASS = { name: "build", command: "npm run build", status: "passed", exitCode: 0, durationMs: 3400 };

function patchKitWithPhases(
  baselineChecks: PhaseCheck[],
  patchedChecks: PhaseCheck[],
  overrides: Partial<PatchKitPayload> = {}
): PatchKitPayload {
  return {
    id: "pk1",
    repo: { owner: "velz-cmd", name: "repodiet-e2e-test", branch: "main" },
    summary: {
      safeDeleteCandidates: 1,
      transformerCompatible: 1,
      dryRunPassed: 1,
      generatedChanges: 1,
      validatedChanges: 1,
      verifiedChanges: 1,
      filesEdited: 0,
      filesDeleted: 1,
      filesAdded: 0,
      rawReviewFindings: 0,
      reviewFirstItems: 0,
      doNotTouchItems: 0,
      packageSuggestions: 0,
      patchLines: 4,
      regressionChecks: 1,
      bundleFileCount: 7,
      ...(overrides.summary ?? {}),
    },
    artifacts: {} as PatchKitPayload["artifacts"],
    downloadUrl: "/api/patches/pk1/download",
    patchValidation: { status: "passed" },
    repositoryVerification: {
      status: "verified",
      installAttempts: [],
      checks: [
        ...baselineChecks.map((c) => ({ ...c, name: `baseline:${c.name}` })),
        ...patchedChecks.map((c) => ({ ...c, name: `patched:${c.name}` })),
      ],
      baseline: { checks: baselineChecks } as { checks: PhaseCheck[] },
      patched: { checks: patchedChecks } as { checks: PhaseCheck[] },
    } as PatchKitPayload["repositoryVerification"],
    remediationPlan: {
      summary: { greenCount: 1, yellowCount: 0, redCount: 0, autoFixEligibleCount: 1 },
    } as PatchKitPayload["remediationPlan"],
    ...overrides,
  };
}

function unitTestGate(report: ReturnType<typeof buildVerificationGateReport>) {
  return report.gates.find((g) => g.id === "unit_tests")!;
}

console.log("verification-gates-baseline-test");

// The exact production shape from funded job 0x22a2…: the repository's suite was
// already red at the approved base commit and stayed red, identically, after the
// approved deletion. repositoryVerification legitimately reports "verified"
// because typecheck and build both pass in both phases.
test("pre-existing identical test failure does not block the safe PR", () => {
  const report = buildVerificationGateReport(
    patchKitWithPhases(
      [TYPECHECK_PASS, TEST_FAILURE, BUILD_PASS],
      [TYPECHECK_PASS, TEST_FAILURE, BUILD_PASS]
    )
  );
  const gate = unitTestGate(report);
  assert.equal(gate.status, "skipped");
  assert.match(gate.detail ?? "", /pre-existing/i);
  assert.equal(report.allRequiredPassed, true);
});

test("newly introduced test failure still blocks (baseline passed)", () => {
  const report = buildVerificationGateReport(
    patchKitWithPhases(
      [TYPECHECK_PASS, TEST_PASS, BUILD_PASS],
      [TYPECHECK_PASS, TEST_FAILURE, BUILD_PASS]
    )
  );
  assert.equal(unitTestGate(report).status, "failed");
  assert.equal(report.allRequiredPassed, false);
});

test("newly introduced test failure still blocks (baseline test absent)", () => {
  const report = buildVerificationGateReport(
    patchKitWithPhases([TYPECHECK_PASS, BUILD_PASS], [TYPECHECK_PASS, TEST_FAILURE, BUILD_PASS])
  );
  assert.equal(unitTestGate(report).status, "failed");
  assert.equal(report.allRequiredPassed, false);
});

// A different breakage must not be excused just because the baseline was also
// red — otherwise a real regression rides in behind a pre-existing failure.
test("patched test failing DIFFERENTLY from baseline still blocks", () => {
  const report = buildVerificationGateReport(
    patchKitWithPhases(
      [TYPECHECK_PASS, TEST_FAILURE, BUILD_PASS],
      [
        TYPECHECK_PASS,
        {
          name: "test",
          status: "failed",
          exitCode: 1,
          stdoutSummary: "1 failing\n  cleanup suite > resolves helper import",
          stderrSummary: "Error: Cannot find module './unused-helper'",
        },
        BUILD_PASS,
      ]
    )
  );
  const gate = unitTestGate(report);
  assert.equal(gate.status, "failed");
  assert.match(gate.detail ?? "", /differs/i);
  assert.equal(report.allRequiredPassed, false);
});

test("different exit code is a different failure and still blocks", () => {
  const report = buildVerificationGateReport(
    patchKitWithPhases(
      [TYPECHECK_PASS, TEST_FAILURE, BUILD_PASS],
      [TYPECHECK_PASS, { ...TEST_FAILURE, exitCode: 137 }, BUILD_PASS]
    )
  );
  assert.equal(unitTestGate(report).status, "failed");
  assert.equal(report.allRequiredPassed, false);
});

test("baseline failure followed by a patched pass passes the gate", () => {
  const report = buildVerificationGateReport(
    patchKitWithPhases(
      [TYPECHECK_PASS, TEST_FAILURE, BUILD_PASS],
      [TYPECHECK_PASS, TEST_PASS, BUILD_PASS]
    )
  );
  assert.equal(unitTestGate(report).status, "passed");
  assert.equal(report.allRequiredPassed, true);
});

test("ordinary passing tests pass the gate", () => {
  const report = buildVerificationGateReport(
    patchKitWithPhases(
      [TYPECHECK_PASS, TEST_PASS, BUILD_PASS],
      [TYPECHECK_PASS, TEST_PASS, BUILD_PASS]
    )
  );
  assert.equal(unitTestGate(report).status, "passed");
  assert.equal(report.allRequiredPassed, true);
});

// Volatile absolute paths and digit runs must not make one failure look like two.
test("same failure through different temp paths and line numbers is still pre-existing", () => {
  const report = buildVerificationGateReport(
    patchKitWithPhases(
      [
        TYPECHECK_PASS,
        {
          name: "test",
          status: "failed",
          exitCode: 1,
          stdoutSummary: "1 failing",
          stderrSummary: "AssertionError at C:\\Temp\\repo-verify-aaa\\src\\x.test.ts:12:5",
        },
        BUILD_PASS,
      ],
      [
        TYPECHECK_PASS,
        {
          name: "test",
          status: "failed",
          exitCode: 1,
          stdoutSummary: "1 failing",
          stderrSummary: "AssertionError at C:\\Temp\\repo-verify-zzz\\src\\x.test.ts:12:5",
        },
        BUILD_PASS,
      ]
    )
  );
  assert.equal(unitTestGate(report).status, "skipped");
  assert.equal(report.allRequiredPassed, true);
});

// The excuse is scoped to unit_tests only — it must never rescue a run that has
// nothing verified, nor stand in for typecheck/build.
test("verifiedChanges=0 is still rejected even with a pre-existing test failure", () => {
  const report = buildVerificationGateReport(
    patchKitWithPhases(
      [TYPECHECK_PASS, TEST_FAILURE, BUILD_PASS],
      [TYPECHECK_PASS, TEST_FAILURE, BUILD_PASS],
      {
        summary: {
          safeDeleteCandidates: 0,
          transformerCompatible: 0,
          dryRunPassed: 0,
          generatedChanges: 0,
          validatedChanges: 0,
          verifiedChanges: 0,
          filesEdited: 0,
          filesDeleted: 0,
          filesAdded: 0,
          rawReviewFindings: 0,
          reviewFirstItems: 0,
          doNotTouchItems: 0,
          packageSuggestions: 0,
          patchLines: 0,
          regressionChecks: 0,
          bundleFileCount: 7,
        },
      }
    )
  );
  assert.equal(unitTestGate(report).status, "skipped");
  const verifiedGate = report.gates.find((g) => g.id === "verified_changes")!;
  assert.equal(verifiedGate.status, "failed");
  assert.equal(report.allRequiredPassed, false);
});

test("a patched typecheck failure still blocks despite a pre-existing test failure", () => {
  const report = buildVerificationGateReport(
    patchKitWithPhases(
      [TYPECHECK_PASS, TEST_FAILURE, BUILD_PASS],
      [
        { name: "typecheck", status: "failed", exitCode: 1 },
        TEST_FAILURE,
        BUILD_PASS,
      ]
    )
  );
  assert.equal(unitTestGate(report).status, "skipped");
  assert.equal(report.gates.find((g) => g.id === "typecheck")!.status, "failed");
  assert.equal(report.allRequiredPassed, false);
});

test("a patched build failure still blocks despite a pre-existing test failure", () => {
  const report = buildVerificationGateReport(
    patchKitWithPhases(
      [TYPECHECK_PASS, TEST_FAILURE, BUILD_PASS],
      [TYPECHECK_PASS, TEST_FAILURE, { name: "build", status: "failed", exitCode: 1 }]
    )
  );
  assert.equal(unitTestGate(report).status, "skipped");
  assert.equal(report.gates.find((g) => g.id === "production_build")!.status, "failed");
  assert.equal(report.allRequiredPassed, false);
});

// Missing test script behaviour is untouched by this change.
test("absent test script keeps existing skipped behaviour when verification passed", () => {
  const report = buildVerificationGateReport(
    patchKitWithPhases([TYPECHECK_PASS, BUILD_PASS], [TYPECHECK_PASS, BUILD_PASS])
  );
  assert.equal(unitTestGate(report).status, "skipped");
  assert.equal(report.allRequiredPassed, true);
});

test("absent test script with unverified repository stays not_run", () => {
  const report = buildVerificationGateReport(
    patchKitWithPhases([TYPECHECK_PASS], [TYPECHECK_PASS], {
      repositoryVerification: {
        status: "not_run",
        installAttempts: [],
        checks: [],
      } as PatchKitPayload["repositoryVerification"],
    })
  );
  assert.equal(unitTestGate(report).status, "not_run");
  assert.equal(report.allRequiredPassed, false);
});

console.log("verification-gates-baseline-test: all tests passed");
