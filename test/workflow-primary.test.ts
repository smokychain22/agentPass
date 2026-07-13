import test from "node:test";
import assert from "node:assert/strict";
import { computeWorkflowGates } from "../src/lib/workflow/gates";
import { resolveFixPrUnlock, buildZeroEligibleMessage } from "../src/lib/workflow/unlock-reasons";
import { decideClassification } from "../src/lib/evidence/decision-matrix";
import type { Finding } from "../src/lib/findings/types";
import type { FindingsPayload } from "../src/lib/findings/types";

function minimalFindings(overrides?: Partial<FindingsPayload>): FindingsPayload {
  return {
    scanId: "scan_test",
    mode: "live",
    repo: { owner: "o", name: "r", branch: "main", commitSha: "abc123" },
    summary: {
      totalFindings: 1,
      duplicateClusters: 0,
      unusedFiles: 1,
      unusedDependencies: 0,
      unusedExports: 0,
      orphanPatterns: 0,
      slopSignals: 0,
      reviewRequired: 0,
      safeCandidates: 1,
      actionableFixes: 1,
      eligibleFindings: 1,
      doNotTouch: 0,
    },
    riskBuckets: { safeDelete: ["f1"], reviewFirst: [], doNotTouch: [] },
    duplicates: [],
    unused: {
      files: [
        {
          id: "f1",
          type: "unused_file",
          title: "Empty",
          files: ["src/unused/empty-module.ts"],
          confidence: 0.9,
          confidenceReason: "test",
          severity: "low",
          action: "safe_candidate",
          source: "knip",
          sourceMode: "native",
          reason: "test",
          evidence: {
            summary: "x",
            signals: ["empty_file=true", "inbound_refs=0", "classification=actionable_candidate"],
          },
        },
      ],
      dependencies: [],
      exports: [],
    },
    orphans: [],
    slopSignals: [],
    rawToolReports: {
      knip: { status: "ok", source: "knip", sourceMode: "native", durationMs: 1 },
      jscpd: { status: "ok", source: "jscpd", sourceMode: "native", durationMs: 1 },
      madge: { status: "ok", source: "madge", sourceMode: "native", durationMs: 1 },
    },
    ...overrides,
  } as FindingsPayload;
}

test("zero eligible message explains cleanup lock", () => {
  const msg = buildZeroEligibleMessage({ totalFindings: 40, reviewCount: 40, githubConnected: true });
  assert.match(msg.title, /No findings are ready/);
  assert.match(msg.body, /40/);
});

test("fix PR unlock requires github, commit, and selected safe scope", () => {
  const locked = resolveFixPrUnlock({
    scanComplete: true,
    commitSha: "abc",
    github: { connected: false } as import("../src/lib/workflow/github-repository-status").RepositoryConnectionStatus,
    selectedFindingIds: ["f1"],
    safeCandidateCount: 1,
  });
  assert.equal(locked.unlocked, false);
  assert.ok(locked.reasons.includes("github_not_connected"));

  const unlocked = resolveFixPrUnlock({
    scanComplete: true,
    commitSha: "abc",
    github: { connected: true } as import("../src/lib/workflow/github-repository-status").RepositoryConnectionStatus,
    selectedFindingIds: ["f1"],
    safeCandidateCount: 1,
  });
  assert.equal(unlocked.unlocked, true);
});

test("workflow gates lock fix and pr when no safe candidates selected", () => {
  const gates = computeWorkflowGates({
    scanComplete: true,
    findings: minimalFindings(),
    patchKit: null,
    commitSha: "abc123",
    githubStatus: {
      connected: true,
      configured: true,
      repository: "o/r",
      owner: "o",
      canRead: true,
      canCreateBranch: true,
      canCreatePullRequest: true,
    },
    selectedFindingIds: [],
  });
  assert.equal(gates.fixPrUnlocked, false);
  assert.match(gates.fixPrLockTitle, /No findings are ready|requirements/i);
});

test("workflow gates unlock verify when a2a execution starts", () => {
  const gates = computeWorkflowGates({
    scanComplete: true,
    findings: minimalFindings(),
    patchKit: null,
    a2aTask: { id: "task_1", status: "generating_changes" },
  });
  assert.equal(gates.verifyUnlocked, true);
});

test("empty file with preflight actionable promotes to strong safe candidate", () => {
  const finding: Finding = {
    id: "f_empty",
    type: "unused_file",
    title: "Empty module",
    files: ["src/unused/empty-module.ts"],
    confidence: 0.9,
    confidenceReason: "test",
    severity: "low",
    action: "review_first",
    reason: "test",
    source: "knip",
    sourceMode: "native",
    evidence: {
      summary: "Empty",
      signals: ["empty_file=true", "inbound_refs=0", "classification=actionable_candidate"],
    },
  };
  const decision = decideClassification({
    finding,
    counterEvidence: [],
    channels: {
      staticImports: true,
      dynamicImports: true,
      configuration: true,
      scripts: true,
      packageExports: true,
      frameworkEntryPoint: false,
      incomplete: [],
    },
    hasPreflightActionable: true,
    transformerAvailable: true,
    actionable: true,
  });
  assert.equal(decision.grade, "strong");
  assert.equal(decision.autoFixAllowed, true);
});

test("single-file delete preflight uses inline diff path", async () => {
  const { dryRunPhase1Fix } = await import("../src/lib/execution/fix-preflight");
  const { prepareRepoWorkspace } = await import("../src/lib/scanner/prepare-workspace");
  const w = await prepareRepoWorkspace("https://github.com/velz-cmd/repodiet-e2e-test", "main");
  try {
    const change = await dryRunPhase1Fix(
      w.rootDir,
      {
        id: "t",
        type: "unused_file",
        title: "empty",
        files: ["src/unused/empty-module.ts"],
        confidence: 0.9,
        confidenceReason: "x",
        severity: "low",
        action: "review_first",
        reason: "x",
        source: "knip",
        sourceMode: "native",
        evidence: { summary: "x", signals: ["empty_file=true", "inbound_refs=0"] },
      },
      "delete_file"
    );
    assert.ok(change);
    assert.ok(change!.unifiedDiff.includes("empty-module.ts"));
    assert.ok(change!.deletions > 0);
  } finally {
    await w.cleanup();
  }
});

test("protected finding cannot be auto-fix allowed", () => {
  const finding: Finding = {
    id: "f_prot",
    type: "unused_file",
    title: "Route",
    files: ["app/api/route.ts"],
    confidence: 0.9,
    confidenceReason: "test",
    severity: "low",
    action: "do_not_touch",
    protected: true,
    reason: "test",
    source: "knip",
    sourceMode: "native",
    evidence: { summary: "x", signals: [] },
  };
  const decision = decideClassification({
    finding,
    counterEvidence: [],
    channels: {
      staticImports: true,
      dynamicImports: true,
      configuration: true,
      scripts: true,
      packageExports: true,
      frameworkEntryPoint: true,
      incomplete: [],
    },
    hasPreflightActionable: true,
    transformerAvailable: true,
    actionable: false,
  });
  assert.equal(decision.action, "do_not_touch");
});
