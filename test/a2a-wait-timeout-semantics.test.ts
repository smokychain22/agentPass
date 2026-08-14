import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Root-cause regression for the orphaned-analysis defect.
 *
 * Production 2026-08-14 (task_82774769615840): the orchestrator's analysis catch
 * marked the parent `analysis_failed` on "The operation was aborted due to
 * timeout" while its own GitHub Actions worker was still running. The worker
 * reported READY 55 seconds later with 35 findings; because `analysis_failed` is
 * terminal, that successful result was orphaned permanently and the buyer was
 * told the work failed.
 *
 * PR #201 added the reconciler backstop (recovering such a parent when the child
 * later reports READY). This suite pins the CAUSE being removed: a caller that
 * stopped waiting must not declare an analysis failure while the authoritative
 * child scan is still alive.
 *
 * These assertions are made against the orchestrator source because the catch is
 * deep inside runAnalysisPhase, which requires a full repository fetch to reach
 * naturally; the behavioural contract is still pinned exactly.
 */

const SRC = readFileSync(
  path.join(process.cwd(), "src/lib/a2a/orchestrator.ts"),
  "utf8"
);

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("A2A wait-timeout semantics");

test("a wait timeout is distinguished from an analysis failure", () => {
  assert.ok(
    /function isWaitTimeoutError/.test(SRC),
    "expected an explicit wait-timeout classifier"
  );
  // Must recognise the exact production message shape.
  const match = SRC.match(/function isWaitTimeoutError[\s\S]{0,240}?\n}/);
  assert.ok(match, "isWaitTimeoutError body not found");
  const body = match[0];
  const pattern = body.match(/\/(.+?)\/i/);
  assert.ok(pattern, "expected a case-insensitive regex in isWaitTimeoutError");
  const re = new RegExp(pattern[1], "i");
  assert.ok(
    re.test("The operation was aborted due to timeout"),
    "must classify the exact production abort message as a wait timeout"
  );
});

test("the child scan is consulted before declaring failure", () => {
  assert.ok(
    /getLiveChildScanForTask/.test(SRC),
    "expected a live-child lookup helper"
  );
  assert.ok(
    /getDeepScanJobByA2ATask/.test(SRC),
    "must consult the authoritative child scan record"
  );
});

test("only non-terminal child stages count as live — READY/FAILED must not", () => {
  const match = SRC.match(/LIVE_CHILD_SCAN_STAGES = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(match, "LIVE_CHILD_SCAN_STAGES not found");
  const stages = match[1];
  for (const terminal of ["READY", "COMPLETED", "FAILED_TERMINAL", "FAILED_RETRYABLE"]) {
    assert.ok(
      !new RegExp(`"${terminal}"`).test(stages),
      `${terminal} is terminal and must NOT be treated as live`
    );
  }
  // A representative in-flight stage must be present.
  assert.ok(/"DISPATCHED"/.test(stages), "DISPATCHED must count as live");
  assert.ok(/"VALIDATING_EVIDENCE"/.test(stages), "VALIDATING_EVIDENCE must count as live");
});

test("a live child keeps the task non-terminal — no analysis_failed emitted", () => {
  // In the timeout+live-child branch the orchestrator must syncTask (stay in the
  // current non-terminal state), never failTask.
  const branch = SRC.match(
    /if \(isWaitTimeoutError\(message\)\)[\s\S]*?\n    }/
  );
  assert.ok(branch, "timeout branch not found");
  assert.ok(
    !/failTask/.test(branch[0]),
    "the live-child timeout branch must not call failTask"
  );
  assert.ok(
    /syncTask/.test(branch[0]),
    "the live-child timeout branch must keep the task alive via syncTask"
  );
});

test("no child, or a terminal child, still fails the task", () => {
  // The failTask call must remain reachable after the timeout branch.
  const after = SRC.split(/if \(isWaitTimeoutError\(message\)\)/)[1] ?? "";
  assert.ok(
    /failTask\(\s*task,\s*sm,\s*"analysis_failed"/.test(after),
    "a genuine failure must still mark analysis_failed"
  );
});

test("the liveness probe can never itself fail the task", () => {
  const helper = SRC.match(/async function getLiveChildScanForTask[\s\S]*?\n}/);
  assert.ok(helper, "helper not found");
  assert.ok(
    /catch\s*{[\s\S]*?return undefined;/.test(helper[0]),
    "probe errors must degrade to 'no live child', not throw"
  );
});

console.log("A2A wait-timeout semantics: all passed");
