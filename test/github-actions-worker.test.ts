import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  analysisConfigDigest,
  createDispatchNonce,
} from "../src/lib/github-actions/dispatch-nonce-store";
import { isActionsDispatcherConfigured } from "../src/lib/github-actions/dispatch-analysis";
import { ACTIONS_ANALYSIS_LIMITS, checkArchiveSize, checkFileCount } from "../src/lib/github-actions/limits";
import { DEEP_SCAN_STAGES } from "../src/lib/deep-scan/types";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("github-actions-worker");

test("workflow file exists with three isolated jobs", () => {
  const wf = fs.readFileSync(
    path.join(process.cwd(), ".github/workflows/repodiet-analysis-worker.yml"),
    "utf8"
  );
  assert.match(wf, /workflow_dispatch/);
  assert.match(wf, /name:\s*claim/);
  assert.match(wf, /name:\s*analyze/);
  assert.match(wf, /name:\s*complete/);
  assert.match(wf, /needs:\s*claim/);
  assert.match(wf, /if:\s*always\(\)/);
  assert.match(wf, /concurrency:/);
  assert.match(wf, /repodiet-analysis-\$/);
  assert.match(wf, /permissions:\s*\n\s*contents:\s*read/);
  // Untrusted job must not reference worker secrets
  const analyzeBlock = wf.split("analyze:")[1]?.split("complete:")[0] ?? "";
  assert.equal(analyzeBlock.includes("REPODIET_WORKER_API_KEY"), false);
  assert.equal(analyzeBlock.includes("secrets.REPODIET_WORKER"), false);
});

test("dispatch stages exist on deep-scan ladder", () => {
  for (const stage of ["DISPATCHING", "DISPATCHED", "WAITING_FOR_RUNNER"] as const) {
    assert.ok(DEEP_SCAN_STAGES.includes(stage), stage);
  }
});

test("duplicate dispatch identity uses stable analysis digest", () => {
  const a = analysisConfigDigest({
    tenantId: "browser:x",
    structureScanId: "scan_1",
    repository: "velz-cmd/Meridian",
    branch: "main",
    sourceCommit: "abc",
    projectRoot: ".",
  });
  const b = analysisConfigDigest({
    tenantId: "browser:x",
    structureScanId: "scan_1",
    repository: "velz-cmd/Meridian",
    branch: "main",
    sourceCommit: "abc",
    projectRoot: ".",
  });
  assert.equal(a, b);
  assert.notEqual(createDispatchNonce(), createDispatchNonce());
});

test("free limits are honest", () => {
  assert.equal(checkArchiveSize(ACTIONS_ANALYSIS_LIMITS.maxArchiveBytes + 1), "REPOSITORY_TOO_LARGE");
  assert.equal(checkFileCount(ACTIONS_ANALYSIS_LIMITS.maxFiles + 1), "FILE_LIMIT_EXCEEDED");
  assert.equal(checkArchiveSize(1), null);
});

test("dispatcherReady is false without token", () => {
  const prev = process.env.REPODIET_ACTIONS_DISPATCH_TOKEN;
  delete process.env.REPODIET_ACTIONS_DISPATCH_TOKEN;
  assert.equal(isActionsDispatcherConfigured(), false);
  if (prev !== undefined) process.env.REPODIET_ACTIONS_DISPATCH_TOKEN = prev;
});

test("claim/analyze/complete scripts enforce secret separation", () => {
  const analyze = fs.readFileSync("scripts/actions-worker/analyze.ts", "utf8");
  assert.match(analyze, /assertNoTrustedSecrets/);
  assert.match(analyze, /WORKER_API_KEY/);
  assert.equal(/REPODIET_WORKER_API_KEY/.test(analyze) && analyze.includes("requireEnv(\"REPODIET_WORKER"), false);
  const claim = fs.readFileSync("scripts/actions-worker/claim.ts", "utf8");
  assert.match(claim, /claim-exchange/);
  assert.match(claim, /ALREADY_CLAIMED/);
  const complete = fs.readFileSync("scripts/actions-worker/complete.ts", "utf8");
  assert.match(complete, /RESULT_ARTIFACT_MISSING/);
});

test("analyze route dispatches Actions when configured", () => {
  const source = fs.readFileSync("src/app/api/findings/analyze/route.ts", "utf8");
  assert.match(source, /dispatchAnalysisWorkflow/);
  assert.match(source, /WAITING_FOR_RUNNER/);
  assert.match(source, /createDispatchNonce/);
});

console.log("github-actions-worker: all passed");
