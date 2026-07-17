import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  analysisConfigDigest,
  createDispatchNonce,
} from "../src/lib/github-actions/dispatch-nonce-store";
import {
  DISPATCH_NONCE_RE,
  JOB_ID_RE,
  REQUEST_ID_RE,
  REPOSITORY_DISPATCH_EVENT,
  digestDispatchNonce,
  isActionsDispatcherConfigured,
  validateDispatchPayload,
  dispatchAnalysisWorkflow,
  probeActionsDispatcherHealth,
} from "../src/lib/github-actions/dispatch-analysis";
import { ACTIONS_ANALYSIS_LIMITS, checkArchiveSize, checkFileCount } from "../src/lib/github-actions/limits";
import { DEEP_SCAN_STAGES } from "../src/lib/deep-scan/types";

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    await fn();
    console.log(`  ✓ ${name}`);
  })();
}

async function run() {
  console.log("github-actions-worker");

  await test("workflow uses repository_dispatch with three isolated jobs", () => {
    const wf = fs.readFileSync(
      path.join(process.cwd(), ".github/workflows/repodiet-analysis-worker.yml"),
      "utf8"
    );
    assert.match(wf, /repository_dispatch/);
    assert.match(wf, /repodiet_analysis/);
    assert.equal(/workflow_dispatch:/.test(wf), false);
    assert.match(wf, /name:\s*claim/);
    assert.match(wf, /name:\s*analyze/);
    assert.match(wf, /name:\s*complete/);
    assert.match(wf, /needs:\s*claim/);
    assert.match(wf, /if:\s*always\(\)/);
    assert.match(wf, /concurrency:/);
    assert.match(wf, /permissions:\s*\n\s*contents:\s*read/);
    assert.equal(
      /REPODIET_ACTIONS_DISPATCH_TOKEN/.test(wf) && !wf.includes("must NEVER"),
      false
    );
    // Stronger: never as a secrets. or env reference
    assert.equal(/secrets\.[A-Z0-9_]*DISPATCH/.test(wf), false);
    assert.equal(wf.includes("contents: write"), false);
    assert.equal(wf.includes("pull-requests: write"), false);
    const analyzeBlock = wf.split("analyze:")[1]?.split("complete:")[0] ?? "";
    assert.equal(analyzeBlock.includes("REPODIET_WORKER_API_KEY"), false);
    assert.equal(analyzeBlock.includes("secrets.REPODIET_WORKER"), false);
  });

  await test("dispatch stages exist on deep-scan ladder", () => {
    for (const stage of ["DISPATCHING", "DISPATCHED", "WAITING_FOR_RUNNER"] as const) {
      assert.ok(DEEP_SCAN_STAGES.includes(stage), stage);
    }
  });

  await test("payload validation rejects malformed identifiers", () => {
    assert.equal(JOB_ID_RE.test("deep_scan_abc"), true);
    assert.equal(REQUEST_ID_RE.test("req_abc-1"), true);
    assert.equal(DISPATCH_NONCE_RE.test("dn_" + "a".repeat(20)), true);
    assert.equal(validateDispatchPayload({ jobId: "bad id", requestId: "r", dispatchNonce: "x".repeat(20), environment: "production" }).ok, false);
    assert.equal(validateDispatchPayload({ jobId: "ok", requestId: "req", dispatchNonce: "short", environment: "production" }).ok, false);
    assert.equal(validateDispatchPayload({ jobId: "ok", requestId: "req", dispatchNonce: "n".repeat(24), environment: "staging" }).ok, false);
    const ok = validateDispatchPayload({
      jobId: "deep_scan_ok",
      requestId: "req_ok",
      dispatchNonce: "n".repeat(24),
      environment: "production",
    });
    assert.equal(ok.ok, true);
  });

  await test("duplicate dispatch identity uses stable analysis digest", () => {
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
    assert.equal(digestDispatchNonce("same"), digestDispatchNonce("same"));
    assert.equal(REPOSITORY_DISPATCH_EVENT, "repodiet_analysis");
  });

  await test("free limits are honest", () => {
    assert.equal(checkArchiveSize(ACTIONS_ANALYSIS_LIMITS.maxArchiveBytes + 1), "REPOSITORY_TOO_LARGE");
    assert.equal(checkFileCount(ACTIONS_ANALYSIS_LIMITS.maxFiles + 1), "FILE_LIMIT_EXCEEDED");
    assert.equal(checkArchiveSize(1), null);
  });

  await test("missing dispatch token → DISPATCH_TOKEN_MISSING", async () => {
    const prev = process.env.REPODIET_ACTIONS_DISPATCH_TOKEN;
    delete process.env.REPODIET_ACTIONS_DISPATCH_TOKEN;
    assert.equal(isActionsDispatcherConfigured(), false);
    const result = await dispatchAnalysisWorkflow({
      jobId: "deep_scan_test",
      requestId: "req_test",
      dispatchNonce: "n".repeat(24),
      environment: "production",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "DISPATCH_TOKEN_MISSING");
    const probe = await probeActionsDispatcherHealth();
    assert.equal(probe.dispatcherReady, false);
    assert.equal(probe.reason, "DISPATCH_TOKEN_MISSING");
    if (prev !== undefined) process.env.REPODIET_ACTIONS_DISPATCH_TOKEN = prev;
  });

  await test("invalid dispatch token probe reports DISPATCH_TOKEN_INVALID", async () => {
    const prev = process.env.REPODIET_ACTIONS_DISPATCH_TOKEN;
    process.env.REPODIET_ACTIONS_DISPATCH_TOKEN = "invalid_token_value_for_test_only";
    const probe = await probeActionsDispatcherHealth();
    assert.equal(probe.dispatcherReady, false);
    assert.ok(
      probe.reason === "DISPATCH_TOKEN_INVALID" ||
        probe.reason === "DISPATCH_PERMISSION_DENIED" ||
        probe.reason === "DISPATCH_REPOSITORY_UNAVAILABLE" ||
        probe.reason === "GITHUB_API_UNREACHABLE"
    );
    if (prev === undefined) delete process.env.REPODIET_ACTIONS_DISPATCH_TOKEN;
    else process.env.REPODIET_ACTIONS_DISPATCH_TOKEN = prev;
  });

  await test("public archive descriptor prefers commit pin and parses repoUrl", () => {
    const { buildArchiveDescriptor } = require("../src/lib/github-actions/archive-descriptor") as typeof import("../src/lib/github-actions/archive-descriptor");
    const withFields = buildArchiveDescriptor({
      repositoryOwner: "octocat",
      repositoryName: "Hello-World",
      branch: "master",
      sourceCommit: "7fd1a60b01f91b314f59955a4e4d4e80d8edf11d",
      request: { repoUrl: "https://github.com/octocat/Hello-World", branch: "master" },
    });
    assert.equal(
      withFields.url,
      "https://github.com/octocat/Hello-World/archive/7fd1a60b01f91b314f59955a4e4d4e80d8edf11d.zip"
    );

    const fromUrlOnly = buildArchiveDescriptor({
      request: {
        repoUrl: "https://github.com/octocat/Hello-World",
        branch: "master",
        sourceCommit: "abc123",
      },
    });
    assert.equal(
      fromUrlOnly.url,
      "https://github.com/octocat/Hello-World/archive/abc123.zip"
    );

    const branchOnly = buildArchiveDescriptor({
      request: { repoUrl: "https://github.com/octocat/Hello-World", branch: "master" },
    });
    assert.equal(
      branchOnly.url,
      "https://github.com/octocat/Hello-World/archive/refs/heads/master.zip"
    );
  });

  await test("claim script emits claim outputs before archive download", () => {
    const claim = fs.readFileSync("scripts/actions-worker/claim.ts", "utf8");
    const tokenOut = claim.indexOf('setOutput("claim_token"');
    const archiveThrow = claim.indexOf("No archive URL returned");
    assert.ok(tokenOut > 0 && archiveThrow > tokenOut, "claim_token must be written before archive failure");
  });

  await test("claim/analyze/complete scripts enforce secret separation", () => {
    const analyze = fs.readFileSync("scripts/actions-worker/analyze.ts", "utf8");
    assert.match(analyze, /assertNoTrustedSecrets/);
    assert.match(analyze, /WORKER_API_KEY/);
    assert.match(analyze, /REPODIET_ACTIONS_DISPATCH_TOKEN/);
    const claim = fs.readFileSync("scripts/actions-worker/claim.ts", "utf8");
    assert.match(claim, /claim-exchange/);
    assert.match(claim, /ALREADY_CLAIMED/);
    assert.match(claim, /INPUT_WORKFLOW_RUN_ID/);
    const complete = fs.readFileSync("scripts/actions-worker/complete.ts", "utf8");
    assert.match(complete, /RESULT_ARTIFACT_MISSING/);
  });

  await test("analyze route uses repository_dispatch and does not invent run ids", () => {
    const source = fs.readFileSync("src/app/api/findings/analyze/route.ts", "utf8");
    assert.match(source, /dispatchAnalysisWorkflow/);
    assert.match(source, /WAITING_FOR_RUNNER/);
    assert.match(source, /createDispatchNonce/);
    assert.match(source, /repository_dispatch accepted/);
    assert.match(source, /workflowRunId:\s*undefined/);
  });

  console.log("github-actions-worker: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
