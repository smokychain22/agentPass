import assert from "node:assert/strict";
import {
  mapDeepScanStageToPhase,
  persistAnalysisJob,
  loadPersistedAnalysisJob,
  clearPersistedAnalysisJob,
} from "../src/lib/findings/client";
import {
  analysisError,
  createRequestId,
  normalizeFindingsClientError,
} from "../src/lib/findings/analysis-errors";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("findings-incident-regression");

test("Failed to fetch maps to structured analysis error, not raw throw", () => {
  const err = normalizeFindingsClientError(new TypeError("Failed to fetch"), {
    structureScanId: "scan_cO1d_RoCMjNn",
    requestId: "req_incident",
  });
  assert.equal(err.code, "INTERNAL_ERROR");
  assert.equal(err.requestId, "req_incident");
  assert.equal(err.structureScanId, "scan_cO1d_RoCMjNn");
  assert.match(err.message, /durable job|connection/i);
  assert.notEqual(err.message, "Failed to fetch");
});

test("worker unavailable contract is honest and retryable", () => {
  const err = analysisError({
    code: "WORKER_UNAVAILABLE",
    message: "Repository analysis is temporarily unavailable.",
    retryable: true,
    requestId: createRequestId(),
    jobId: "deep_scan_test",
    statusUrl: "/api/deep-scans/deep_scan_test",
    structureScanId: "scan_cO1d_RoCMjNn",
    requiredAction:
      "The task is safely queued and will continue when a worker becomes available.",
  });
  assert.equal(err.code, "WORKER_UNAVAILABLE");
  assert.equal(err.retryable, true);
  assert.ok(err.statusUrl);
  assert.ok(err.jobId);
});

test("deep-scan stages map into findings progress phases", () => {
  assert.equal(mapDeepScanStageToPhase("QUEUED"), "queued");
  assert.equal(mapDeepScanStageToPhase("CLAIMED"), "claimed");
  assert.equal(mapDeepScanStageToPhase("RUNNING_ANALYZERS"), "analyzers");
  assert.equal(mapDeepScanStageToPhase("READY"), "ready");
});

test("duplicate-click idempotency uses persisted analysis job identity", () => {
  // jsdom-less: simulate storage with a tiny stub when window is missing.
  const memory = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => {
      memory.set(k, v);
    },
    removeItem: (k) => {
      memory.delete(k);
    },
    clear: () => memory.clear(),
    key: () => null,
    length: 0,
  } as Storage;
  (globalThis as { window?: unknown }).window = globalThis;

  persistAnalysisJob({
    structureScanId: "scan_cO1d_RoCMjNn",
    jobId: "deep_scan_once",
    statusUrl: "/api/deep-scans/deep_scan_once",
    requestId: "req_once",
  });
  const loaded = loadPersistedAnalysisJob("scan_cO1d_RoCMjNn");
  assert.equal(loaded?.jobId, "deep_scan_once");
  assert.equal(loadPersistedAnalysisJob("scan_other"), null);
  clearPersistedAnalysisJob();
  assert.equal(loadPersistedAnalysisJob("scan_cO1d_RoCMjNn"), null);
});

console.log("findings-incident-regression: all passed");
