import assert from "node:assert/strict";
import { ToolExecutionError } from "../src/lib/a2mcp/errors";
import { summarizeVerificationForDiagnostics } from "../src/lib/operator/verification-diagnostics";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("verification-diagnostics-details");

/**
 * Row 8 (2026-08-09, SHA 74e73ad/7003d0f): a real production failure's
 * terse message alone couldn't distinguish a genuinely slow check from a
 * retry storm or something else — the per-check/per-attempt durationMs data
 * that would have answered that was computed in repositoryVerification and
 * then discarded before reaching any caller. These tests cover the fix:
 * ToolExecutionError can now carry that data as `details`, and the
 * projection that builds it is a pure, directly-testable function.
 */

test("ToolExecutionError's details defaults to undefined — every existing 3-arg call site is unaffected", () => {
  const err = new ToolExecutionError("INTERNAL_ERROR", "something failed", 500);
  assert.equal(err.details, undefined);
  assert.equal(err.code, "INTERNAL_ERROR");
  assert.equal(err.status, 500);
});

test("ToolExecutionError carries an explicit details payload when given one", () => {
  const details = { checks: [{ name: "build", status: "failed", exitCode: null, durationMs: 300000 }] };
  const err = new ToolExecutionError("NO_SAFE_CANDIDATES", "verification failed", 422, details);
  assert.deepEqual(err.details, details);
});

test("summarizeVerificationForDiagnostics returns undefined when there is no verification result at all", () => {
  assert.equal(summarizeVerificationForDiagnostics(undefined), undefined);
});

test("summarizeVerificationForDiagnostics defaults checks/installAttempts to empty arrays when the result omits them", () => {
  const result = summarizeVerificationForDiagnostics({ status: "failed" });
  assert.deepEqual(result, { checks: [], installAttempts: [] });
});

test("summarizeVerificationForDiagnostics projects real per-check and per-attempt timing", () => {
  const result = summarizeVerificationForDiagnostics({
    status: "baseline_blocked",
    error: 'Baseline repository already fails verification — build: Verification command "build" exceeded its time limit and was terminated (no error output was emitted).',
    checks: [
      { name: "baseline:dependency install", command: "npm ci", status: "passed", exitCode: 0, durationMs: 4200, stdoutSummary: "", stderrSummary: "" },
      { name: "baseline:typecheck", command: "tsc --noEmit", status: "passed", exitCode: 0, durationMs: 8100, stdoutSummary: "", stderrSummary: "" },
      { name: "baseline:build", command: "next build", status: "failed", exitCode: null, durationMs: 300004, stdoutSummary: "", stderrSummary: 'Verification command "build" exceeded its time limit and was terminated (no error output was emitted).' },
    ],
    installAttempts: [
      { command: "npm ci --cache /tmp/x", attempt: 1, exitCode: 0, stdout: "", stderr: "", durationMs: 4200 },
    ],
  });

  const checks = result?.checks ?? [];
  assert.deepEqual(
    checks.map((c) => c.name),
    ["baseline:dependency install", "baseline:typecheck", "baseline:build"]
  );
  const buildCheck = checks.find((c) => c.name === "baseline:build");
  assert.equal(buildCheck?.status, "failed");
  assert.equal(buildCheck?.durationMs, 300004, "the real elapsed time must survive the projection, unrounded");
  assert.equal(result?.installAttempts[0]?.durationMs, 4200);

  // The whole point: this is the data that answers "which phase, how long" —
  // a future failure's console output should never again require guessing.
  assert.ok(
    checks.reduce((sum, c) => sum + c.durationMs, 0) > 300000,
    "the projected durations must be real enough to sum to a plausible total run time"
  );
});

test("summarizeVerificationForDiagnostics never includes stdout/stderr blobs — only name/status/exitCode/durationMs", () => {
  const result = summarizeVerificationForDiagnostics({
    status: "regression_failed",
    checks: [
      {
        name: "patched:build",
        command: "next build",
        status: "failed",
        exitCode: 1,
        durationMs: 5000,
        stdoutSummary: "a huge build log that should never be duplicated into details",
        stderrSummary: "a huge stderr blob",
      },
    ],
    installAttempts: [],
  });
  const keys = Object.keys(result?.checks[0] ?? {});
  assert.deepEqual(keys.sort(), ["durationMs", "exitCode", "name", "status"]);
});

console.log("verification-diagnostics-details: all tests passed");
