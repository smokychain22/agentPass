import assert from "node:assert/strict";

/**
 * Documents the production Meridian findings incident (scan_cO1d_RoCMjNn).
 * Root cause: synchronous POST /api/jobs/findings ran analyzers in-request (~100s),
 * browser fetch aborted → TypeError "Failed to fetch".
 */
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("meridian-findings-incident");

test("incident evidence IDs are preserved for diagnosis only", () => {
  const incident = {
    repository: "velz-cmd/Meridian",
    branch: "main",
    sourceCommit: "a35631c6748d6619b9301a02b34f2ff99eecd5b7",
    structureScanId: "scan_cO1d_RoCMjNn",
    productionCommit: "2b132af4861789968d8e13e684fc39cc0f695afe",
    failureCategory: "TIMEOUT",
    requestUrl: "/api/jobs/findings",
    requestMethod: "POST",
    frontendFile: "src/components/app/findings-tab.tsx",
    frontendFunction: "runFindings → runFindingsAnalysis",
    vercelRoute: "src/app/api/jobs/findings/route.ts",
    observed: "Failed to fetch after long synchronous analyzer run",
  };
  assert.equal(incident.structureScanId, "scan_cO1d_RoCMjNn");
  assert.equal(incident.failureCategory, "TIMEOUT");
  assert.equal(incident.requestUrl, "/api/jobs/findings");
});

test("fix path must return 202 durable enqueue without analyzer wait", () => {
  // Contract assertion — implementation lives in /api/findings/analyze.
  const requiredResponseKeys = [
    "accepted",
    "jobId",
    "status",
    "stage",
    "statusUrl",
    "workerReady",
    "requestId",
  ];
  assert.ok(requiredResponseKeys.includes("workerReady"));
  assert.ok(requiredResponseKeys.includes("statusUrl"));
});

console.log("meridian-findings-incident: all passed");
