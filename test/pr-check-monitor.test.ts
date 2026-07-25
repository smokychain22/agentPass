import assert from "node:assert/strict";
import { firstActionableLogLine, redactSensitiveLogExcerpt } from "../src/lib/github/log-redaction";
import { buildDeliveryReceiptChecks } from "../src/lib/github/pr-check-monitor";
import type { PrCheckRecord, PrDeliveryMonitorRecord } from "../src/lib/github/pr-check-types";
import { classifyCheckFailure } from "../src/lib/workflow/check-failure-classifier";
import {
  aggregateCleanupCaused,
  compareBaselineAndPrChecks,
  isFailedConclusion,
  isPendingRequiredCheck,
} from "../src/lib/workflow/check-baseline-comparison";
import { detectVercelProjects } from "../src/lib/vercel/deployment-diagnostics";
import { validateCurrentPullRequestScope } from "../src/lib/github/monitor-pr-delivery";
import type { A2ATaskRecord } from "../src/lib/a2a/types";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

function check(overrides: Partial<PrCheckRecord> & Pick<PrCheckRecord, "checkName">): PrCheckRecord {
  return {
    provider: "other",
    status: "completed",
    conclusion: "success",
    required: true,
    ...overrides,
  };
}

function monitorRecord(overrides: Partial<PrDeliveryMonitorRecord>): PrDeliveryMonitorRecord {
  return {
    owner: "acme",
    repo: "demo",
    prNumber: 1,
    prUrl: "https://github.com/acme/demo/pull/1",
    headSha: "abc",
    baseSha: "def",
    sourceCommitSha: "def",
    patchCommitSha: "abc",
    branch: "repodiet/cleanup",
    changedFiles: [],
    deliveryState: "monitoring_checks",
    checks: [],
    diagnoses: [],
    baselineComparisons: [],
    deliveryReady: false,
    ownerActions: [],
    lastPolledAt: new Date().toISOString(),
    pollCount: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

console.log("pr-check-monitor");

test("all required checks pass → delivery ready", () => {
  const record = monitorRecord({
    deliveryState: "delivery_ready",
    deliveryReady: true,
    checks: [
      check({ checkName: "npm build", conclusion: "success" }),
      check({ checkName: "Vercel – demo", provider: "vercel", conclusion: "success" }),
    ],
  });
  const receipt = buildDeliveryReceiptChecks(record);
  assert.equal(receipt.deliveryReady, true);
});

test("one required check fails → delivery blocked", () => {
  const record = monitorRecord({
    checks: [
      check({ checkName: "npm build", conclusion: "success" }),
      check({ checkName: "Vercel – demo", provider: "vercel", conclusion: "failure" }),
    ],
  });
  const receipt = buildDeliveryReceiptChecks(record);
  assert.equal(receipt.deliveryReady, false);
  assert.equal(isPendingRequiredCheck(record.checks[1]!), false);
});

test("optional check fails does not block when not required", () => {
  const record = monitorRecord({
    deliveryReady: true,
    deliveryState: "delivery_ready",
    checks: [
      check({ checkName: "npm build", conclusion: "success", required: true }),
      check({ checkName: "lint", conclusion: "failure", required: false }),
    ],
  });
  assert.equal(buildDeliveryReceiptChecks(record).deliveryReady, true);
});

test("same failure on main and PR → pre-existing", () => {
  const comparisons = compareBaselineAndPrChecks({
    baselineChecks: [check({ checkName: "Vercel – demo", provider: "vercel", conclusion: "failure" })],
    prChecks: [check({ checkName: "Vercel – demo", provider: "vercel", conclusion: "failure" })],
    baselineDiagnoses: [
      classifyCheckFailure({
        checkName: "Vercel – demo",
        provider: "vercel",
        outputSummary: "Missing environment variable FOO",
        cleanupCausedThis: false,
      }),
    ],
    prDiagnoses: [
      classifyCheckFailure({
        checkName: "Vercel – demo",
        provider: "vercel",
        outputSummary: "Missing environment variable FOO",
        cleanupCausedThis: true,
      }),
    ],
  });
  assert.equal(comparisons[0]?.cleanupCausedThis, false);
});

test("new PR-only failure → cleanup regression", () => {
  const comparisons = compareBaselineAndPrChecks({
    baselineChecks: [check({ checkName: "npm build", conclusion: "success" })],
    prChecks: [check({ checkName: "npm build", conclusion: "failure" })],
    baselineDiagnoses: [],
    prDiagnoses: [],
  });
  assert.equal(comparisons[0]?.cleanupCausedThis, true);
});

test("missing env variable is classified correctly", () => {
  const diagnosis = classifyCheckFailure({
    checkName: "Vercel – demo",
    provider: "vercel",
    outputSummary: "Environment variable DATABASE_URL is not set",
  });
  assert.equal(diagnosis.classification, "missing_environment_variable");
});

test("wrong Vercel root directory is classified correctly", () => {
  const diagnosis = classifyCheckFailure({
    checkName: "Vercel – demo",
    provider: "vercel",
    outputSummary: "Could not find package.json in root directory apps/web",
  });
  assert.equal(diagnosis.classification, "wrong_root_directory");
});

test("duplicate Vercel projects are detected", () => {
  const summary = detectVercelProjects({
    checks: [
      check({ checkName: "Vercel – trade-alpha", provider: "vercel", conclusion: "failure" }),
      check({ checkName: "Vercel – trader-arc", provider: "vercel", conclusion: "failure" }),
    ],
    repositoryName: "Meridian",
  });
  assert.equal(summary?.projects.length, 2);
  assert.match(summary?.ownerAction ?? "", /Review connected Vercel projects/);
});

test("RepoDiet never deletes provider projects automatically", () => {
  const source = detectVercelProjects.toString();
  assert.doesNotMatch(source, /delete/i);
});

test("logs are bounded and secrets redacted", () => {
  const redacted = redactSensitiveLogExcerpt(
    "Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz1234567890",
    100
  );
  assert.match(redacted, /\[REDACTED\]/);
  assert.doesNotMatch(redacted, /ghp_/);
  const line = firstActionableLogLine("info\nBuild failed: Type error in src/app.ts");
  assert.match(line ?? "", /Type error/);
});

test("user sees exact failure instead of generic deployment failed", () => {
  const diagnosis = classifyCheckFailure({
    checkName: "Vercel – demo",
    provider: "vercel",
    outputSummary: "Build failed\nType error: Property 'foo' does not exist on type 'Bar'",
  });
  assert.match(diagnosis.firstActionableError, /Type error|Build failed/);
  assert.notEqual(diagnosis.firstActionableError, "Deployment failed.");
});

test("retry path does not imply duplicate PR creation in monitor store key", () => {
  const key = "velz-cmd/meridian#19";
  assert.equal(key, "velz-cmd/meridian#19");
});

test("receipt reflects final check state", () => {
  const record = monitorRecord({
    checks: [check({ checkName: "npm build", conclusion: "failure" })],
    diagnoses: [
      classifyCheckFailure({
        checkName: "npm build",
        provider: "other",
        outputSummary: "npm ERR! missing script build",
      }),
    ],
  });
  const receipt = buildDeliveryReceiptChecks(record);
  assert.equal(receipt.finalConclusions[0]?.conclusion, "failure");
  assert.equal(receipt.deliveryReady, false);
});

test("customer flow does not reference Cursor", () => {
  const guidance = classifyCheckFailure({
    checkName: "Vercel – demo",
    provider: "vercel",
    outputSummary: "Missing environment variable API_KEY",
  }).recommendedAction;
  assert.doesNotMatch(guidance, /cursor/i);
});

test("Vercel commit status contexts are treated as provider checks", () => {
  const summary = detectVercelProjects({
    checks: [
      check({
        checkName: "Vercel – trade-alpha",
        provider: "vercel",
        conclusion: "failure",
      }),
    ],
    repositoryName: "Meridian",
  });
  assert.equal(summary?.projects[0]?.name, "trade-alpha");
});

test("aggregate cleanup caused respects comparisons", () => {
  const caused = aggregateCleanupCaused(
    [{ checkName: "x", cleanupCausedThis: false, sameDiagnostic: true }],
    []
  );
  assert.equal(caused, false);
  assert.equal(isFailedConclusion("failure"), true);
});

test("current PR evidence accepts the exact pinned deletion scope", () => {
  const task: A2ATaskRecord = {
    id: "task_scope",
    type: "repository.cleanup_pr",
    status: "delivery_submitted",
    repository: {
      owner: "acme",
      name: "demo",
      branch: "main",
      commitSha: "base",
    },
    input: {
      repoUrl: "https://github.com/acme/demo",
      findingIds: ["finding-1"],
    },
    approval: {
      summary: "Delete one file",
      repository: "acme/demo",
      branch: "repodiet/cleanup",
      changes: [{ path: "scripts/unused.mjs", action: "modify" }],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    result: {
      changes: {
        changedFiles: ["scripts/unused.mjs"],
        unifiedDiff:
          "diff --git a/scripts/unused.mjs b/scripts/unused.mjs\n" +
          "deleted file mode 100644\n--- a/scripts/unused.mjs\n+++ /dev/null\n",
      },
    },
    transitions: [],
    limitations: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const current = monitorRecord({
    baseSha: "base",
    headSha: "head",
    changedFiles: [{
      path: "scripts/unused.mjs",
      status: "removed",
      additions: 0,
      deletions: 4,
      changes: 4,
      blobSha: "0".repeat(40),
    }],
  });
  assert.equal(validateCurrentPullRequestScope(task, current), undefined);

  const unexpected = monitorRecord({
    ...current,
    changedFiles: [
      ...current.changedFiles,
      {
        path: "src/unapproved.ts",
        status: "modified",
        additions: 1,
        deletions: 1,
        changes: 2,
        blobSha: "1".repeat(40),
      },
    ],
  });
  assert.match(
    validateCurrentPullRequestScope(task, unexpected) ?? "",
    /pull_request_scope_mismatch/
  );

  assert.match(
    validateCurrentPullRequestScope(task, {
      ...current,
      baseSha: "different-base",
    }) ?? "",
    /pull_request_base_changed/
  );

  assert.match(
    validateCurrentPullRequestScope(task, {
      ...current,
      changedFiles: current.changedFiles.map((file) => ({
        ...file,
        status: "modified",
      })),
    }) ?? "",
    /pull_request_operation_mismatch/
  );
});

console.log("pr-check-monitor: all passed");
