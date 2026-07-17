import assert from "node:assert/strict";
import { FINDINGS_MAX_QUEUE_WAIT_MS } from "../src/lib/findings/client";
import { MERIDIAN_INCIDENT_COVERAGE_EXPLAIN } from "../src/lib/scanner/coverage-label-explain";
import { analysisError } from "../src/lib/findings/analysis-errors";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("findings-offline-and-coverage");

test("max queue wait budget is finite and honest", () => {
  assert.ok(FINDINGS_MAX_QUEUE_WAIT_MS >= 60_000);
  assert.ok(FINDINGS_MAX_QUEUE_WAIT_MS <= 30 * 60_000);
  const delayed = analysisError({
    code: "QUEUE_WAIT_EXCEEDED",
    message: "No analysis worker claimed this job within the queue-wait budget.",
    retryable: true,
    requestId: "req_q",
    requiredAction: "RESUME_LATER_OR_CANCEL",
  });
  assert.equal(delayed.code, "QUEUE_WAIT_EXCEEDED");
  assert.equal(delayed.retryable, true);
});

test("Meridian 407 vs 473 explanation is documented", () => {
  assert.equal(MERIDIAN_INCIDENT_COVERAGE_EXPLAIN.supportedJsTsSource, 407);
  assert.equal(MERIDIAN_INCIDENT_COVERAGE_EXPLAIN.repositoryModelAnalyzablePaths, 473);
  assert.match(MERIDIAN_INCIDENT_COVERAGE_EXPLAIN.whyDifferent, /different/i);
});

console.log("findings-offline-and-coverage: all passed");
