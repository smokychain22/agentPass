import assert from "node:assert/strict";
import {
  deriveScanFindingsState,
  scanFindingsStateHasCounters,
  scanFindingsStateLabel,
} from "../src/lib/findings/scan-state";
import { analysisError } from "../src/lib/findings/analysis-errors";
import type { FindingsPayload } from "../src/lib/findings/types";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

function findingsPayload(totalFindings: number, scanCoverageWarning?: string): FindingsPayload {
  return {
    scanId: "scan_1",
    repo: { owner: "acme", name: "app", branch: "main", commitSha: "sha1", url: "https://github.com/acme/app" },
    summary: {
      totalFindings,
      duplicateClusters: 0,
      unusedFiles: 0,
      unusedDependencies: 0,
      unusedExports: 0,
      orphanPatterns: 0,
      slopSignals: 0,
      reviewRequired: 0,
      safeCandidates: 0,
      doNotTouch: 0,
    },
    duplicates: [],
    unused: { files: [], dependencies: [], exports: [] },
    orphans: [],
    slopSignals: [],
    riskBuckets: { safeDelete: [], reviewFirst: [], doNotTouch: [] },
    artifacts: { findingsJson: true },
    mode: "live",
    scanCoverageWarning,
    rawToolReports: {
      knip: { status: "ok", sourceMode: "native" } as unknown as FindingsPayload["rawToolReports"]["knip"],
      jscpd: { status: "ok", sourceMode: "native" } as unknown as FindingsPayload["rawToolReports"]["jscpd"],
      madge: { status: "ok", sourceMode: "native" } as unknown as FindingsPayload["rawToolReports"]["madge"],
    },
  } as FindingsPayload;
}

console.log("Scan + findings truthful state");

test("no scan yet is connecting_repository, never zero counters", () => {
  const state = deriveScanFindingsState({
    scanComplete: false,
    findings: null,
    findingsAnalysisPhase: "idle",
    findingsAnalysisError: null,
  });
  assert.equal(state, "connecting_repository");
  assert.equal(scanFindingsStateHasCounters(state), false);
});

test("findings analysis in progress never shows zero counters, regardless of phase", () => {
  for (const phase of [
    "queued", "dispatching", "dispatched", "waiting_runner", "claimed",
    "preparing_archive", "downloading_archive", "archive_ready", "inventory",
    "resolving", "graph", "running_knip", "analyzers", "normalizing",
    "validating", "persisting", "baseline",
  ] as const) {
    const state = deriveScanFindingsState({
      scanComplete: true,
      findings: null,
      findingsAnalysisPhase: phase,
      findingsAnalysisError: null,
    });
    assert.equal(
      scanFindingsStateHasCounters(state),
      false,
      `phase ${phase} must not show finding counters yet`
    );
  }
});

test("a genuine zero-finding result still reports real coverage, not the pending state", () => {
  const state = deriveScanFindingsState({
    scanComplete: true,
    findings: findingsPayload(0),
    findingsAnalysisPhase: "ready",
    findingsAnalysisError: null,
  });
  assert.equal(state, "complete_with_zero_findings");
  assert.equal(scanFindingsStateHasCounters(state), true);
});

test("a nonzero finding result is complete_with_findings and shows counters", () => {
  const state = deriveScanFindingsState({
    scanComplete: true,
    findings: findingsPayload(12),
    findingsAnalysisPhase: "ready",
    findingsAnalysisError: null,
  });
  assert.equal(state, "complete_with_findings");
  assert.equal(scanFindingsStateHasCounters(state), true);
});

test("bounded/partial coverage is reported honestly, not as a clean complete", () => {
  const state = deriveScanFindingsState({
    scanComplete: true,
    findings: findingsPayload(5, "Bounded scan — partial coverage."),
    findingsAnalysisPhase: "ready",
    findingsAnalysisError: null,
  });
  assert.equal(state, "partial");
});

test("a retryable failure never becomes a clean zero-finding result", () => {
  const err = analysisError({
    code: "INTERNAL_ERROR",
    message: "worker crashed",
    retryable: true,
    requestId: "req_1",
    requiredAction: "RETRY",
  });
  const state = deriveScanFindingsState({
    scanComplete: true,
    findings: null,
    findingsAnalysisPhase: "failed",
    findingsAnalysisError: err,
  });
  assert.equal(state, "failed");
  assert.notEqual(state, "complete_with_zero_findings");
});

test("a non-retryable failure is unavailable, never a clean zero-finding result", () => {
  const err = analysisError({
    code: "UNSUPPORTED_REPOSITORY",
    message: "repository access revoked",
    retryable: false,
    requestId: "req_2",
    requiredAction: "CONTACT_SUPPORT",
  });
  const state = deriveScanFindingsState({
    scanComplete: true,
    findings: null,
    findingsAnalysisPhase: "failed",
    findingsAnalysisError: err,
  });
  assert.equal(state, "unavailable");
  assert.notEqual(state, "complete_with_zero_findings");
});

test("an existing durable findings payload always wins over a stale in-flight phase", () => {
  // Even if the client still thinks a phase is mid-run, a real payload is authoritative.
  const state = deriveScanFindingsState({
    scanComplete: true,
    findings: findingsPayload(3),
    findingsAnalysisPhase: "analyzers",
    findingsAnalysisError: null,
  });
  assert.equal(state, "complete_with_findings");
});

test("stale takes priority over every other signal", () => {
  const state = deriveScanFindingsState({
    scanComplete: true,
    findings: findingsPayload(3),
    findingsAnalysisPhase: "ready",
    findingsAnalysisError: null,
    stale: true,
  });
  assert.equal(state, "stale");
});

test("every state has a distinct, non-empty label", () => {
  const states = [
    "connecting_repository", "resolving_commit", "inventorying", "analysing_findings",
    "partial", "complete_with_findings", "complete_with_zero_findings", "failed",
    "stale", "unavailable",
  ] as const;
  const labels = new Set(states.map(scanFindingsStateLabel));
  assert.equal(labels.size, states.length);
  for (const label of labels) assert.ok(label.length > 0);
});

console.log("Scan + findings truthful state: all passed");
