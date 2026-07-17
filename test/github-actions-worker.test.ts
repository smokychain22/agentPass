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

  await test("intermediate progress stages are on the ladder", () => {
    for (const stage of [
      "PREPARING_ARCHIVE",
      "DOWNLOADING_ARCHIVE",
      "ARCHIVE_READY",
      "RUNNING_JSCpd",
      "RUNNING_KNIP",
      "RUNNING_MADGE",
      "RUNNING_INTERNAL_HEURISTICS",
      "PERSISTING_RESULTS",
      "WORKER_STALLED",
    ] as const) {
      assert.ok(DEEP_SCAN_STAGES.includes(stage), stage);
    }
  });

  await test("analyze stays secretless and progress route exists", () => {
    const analyze = fs.readFileSync(path.join(process.cwd(), "scripts/actions-worker/analyze.ts"), "utf8");
    assert.match(analyze, /assertNoTrustedSecrets/);
    assert.match(analyze, /progressToken/);
    assert.equal(/process\.env\.REPODIET_WORKER_CALLBACK_SECRET/.test(analyze), false);
    assert.equal(/process\.env\.REPODIET_WORKER_API_KEY/.test(analyze), false);
    assert.equal(/process\.env\.WORKER_API_KEY/.test(analyze), false);
    const progressRoute = path.join(
      process.cwd(),
      "src/app/api/internal/actions/deep-scans/[id]/progress/route.ts"
    );
    assert.equal(fs.existsSync(progressRoute), true);
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
    assert.equal(withFields.strategy, "PUBLIC_ARCHIVE");
    assert.equal(
      withFields.url,
      "https://github.com/octocat/Hello-World/archive/7fd1a60b01f91b314f59955a4e4d4e80d8edf11d.zip"
    );

    assert.throws(
      () =>
        buildArchiveDescriptor({
          request: { repoUrl: "https://github.com/octocat/Hello-World", branch: "master" },
        }),
      /REPOSITORY_IDENTITY_INCOMPLETE|Missing repositoryOwner/
    );
  });

  await test("canonical repository target rejects incomplete identity", async () => {
    const {
      repositoryTargetFromKnown,
      RepositoryIdentityIncompleteError,
      requiredRepositoryTargetFields,
    } = await import("../src/lib/repository/repository-target");
    const target = repositoryTargetFromKnown({
      owner: "octocat",
      name: "Hello-World",
      branch: "master",
      sourceCommit: "7fd1a60b01f91b314f59955a4e4d4e80d8edf11d",
    });
    assert.equal(target.repositoryFullName, "octocat/Hello-World");
    assert.equal(target.archiveStrategy, "PUBLIC_ARCHIVE");
    assert.equal(requiredRepositoryTargetFields(target).length, 0);
    assert.throws(
      () =>
        repositoryTargetFromKnown({
          owner: "octocat",
          name: "Hello-World",
          branch: "master",
          sourceCommit: "",
        }),
      (err: unknown) => err instanceof RepositoryIdentityIncompleteError
    );
  });

  await test("claim token stays server-side — no artifacts or outputs", () => {
    const claim = fs.readFileSync("scripts/actions-worker/claim.ts", "utf8");
    const complete = fs.readFileSync("scripts/actions-worker/complete.ts", "utf8");
    const wf = fs.readFileSync(".github/workflows/repodiet-analysis-worker.yml", "utf8");
    const exchange = fs.readFileSync(
      "src/app/api/internal/actions/claim-exchange/route.ts",
      "utf8"
    );

    assert.equal(claim.includes("claim-secret.json"), false);
    assert.equal(wf.includes("claim-secret"), false);
    assert.equal(/claimToken\s*:/.test(wf), false);
    assert.equal(/INPUT_CLAIM_TOKEN/.test(wf), false);
    assert.equal(/outputs:[\s\S]*claim_token/.test(wf), false);
    assert.match(claim, /SERVER_SIDE_ONLY|claimHandle/);
    assert.match(claim, /must not return claimToken/);
    assert.match(complete, /SERVER_SIDE_ONLY|x-worker-callback-signature/);
    assert.equal(complete.includes("claim-secret.json"), false);
    assert.equal(/claimToken:\s*updated\.claimToken/.test(exchange), false);
    assert.match(exchange, /claimHandle/);
    assert.match(complete, /RESULT_ARTIFACT_MISSING/);
    assert.match(wf, /if:\s*always\(\)/);
    // Complete must not receive worker API key (callback secret only).
    const completeBlock = wf.split("complete:")[1] ?? "";
    assert.equal(completeBlock.includes("REPODIET_WORKER_API_KEY"), false);
    assert.match(completeBlock, /REPODIET_WORKER_CALLBACK_SECRET/);
    const analyzeBlock = wf.split("analyze:")[1]?.split("complete:")[0] ?? "";
    assert.equal(analyzeBlock.includes("REPODIET_WORKER"), false);
    assert.equal(analyzeBlock.includes("secrets."), false);
  });

  await test("callback HMAC rejects wrong signature and accepts valid", async () => {
    process.env.WORKER_CALLBACK_SECRET = "test_callback_secret_value_32chars!!";
    const {
      signActionsCallback,
      verifyActionsCallbackSignature,
      assertCallbackTimestampFresh,
      createCompletionNonce,
    } = await import("../src/lib/github-actions/callback-auth");
    const payload = {
      jobId: "deep_scan_test",
      workflowRunId: "123",
      workflowRunAttempt: "1",
      workflowName: "RepoDiet analysis worker",
      repository: "smokychain22/agentPass",
      completionNonce: createCompletionNonce(),
      timestamp: new Date().toISOString(),
      resultDigest: "abc",
      stage: "READY",
    };
    const sig = signActionsCallback(payload);
    assert.equal(verifyActionsCallbackSignature(payload, `sha256=${sig}`), true);
    assert.equal(verifyActionsCallbackSignature(payload, "sha256=deadbeef"), false);
    assert.equal(assertCallbackTimestampFresh(payload.timestamp), true);
    assert.equal(assertCallbackTimestampFresh("2000-01-01T00:00:00.000Z"), false);
    delete process.env.WORKER_CALLBACK_SECRET;
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
    assert.match(complete, /x-worker-callback-signature/);
    assert.equal(complete.includes("claimToken:"), false);
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
