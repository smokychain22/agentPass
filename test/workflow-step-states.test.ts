import test from "node:test";
import assert from "node:assert/strict";
import {
  isCleanupPrComplete,
  isFindingsBoundToActiveScan,
  isFindingsStepComplete,
  isRepositoryConnected,
  isReviewAcceptComplete,
  resolveWorkflowStepStates,
} from "../src/lib/workflow/step-states";
import type { FindingsPayload } from "../src/lib/findings/types";
import type { ScanPayload } from "../src/lib/scanner/run-scan";
import type { WorkflowA2ATask } from "../src/lib/workflow/client";

function scan(overrides?: Partial<ScanPayload>): ScanPayload {
  return {
    id: "scan_abc",
    repo: {
      owner: "acme",
      name: "app",
      branch: "main",
      url: "https://github.com/acme/app",
      commitSha: "deadbeef01",
    },
    framework: { name: "Next.js", confidence: 1, signals: ["next"] },
    packageManager: "npm",
    summary: {
      totalFiles: 10,
      totalFolders: 3,
      totalSizeKb: 1,
      topExtensions: { ts: 10 },
    },
    topLevelFolders: [],
    configFiles: [],
    largestFiles: [],
    warnings: [],
    ...overrides,
  } as ScanPayload;
}

function findings(overrides?: Partial<FindingsPayload>): FindingsPayload {
  return {
    scanId: "scan_abc",
    mode: "live",
    repo: {
      owner: "acme",
      name: "app",
      branch: "main",
      commitSha: "deadbeef01",
    },
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
      transformerCompatible: 1,
      dryRunPassed: 1,
      doNotTouch: 0,
    },
    duplicates: [],
    unused: {
      files: [
        {
          id: "f1",
          type: "unused_file",
          title: "Unused file",
          files: ["src/tmp.ts"],
          confidence: 0.9,
          confidenceReason: "test",
          severity: "low",
          action: "safe_candidate",
          source: "knip",
          sourceMode: "native",
          reason: "test",
          evidence: {
            summary: "unused file",
            signals: ["empty_file=true", "inbound_refs=0", "classification=actionable_candidate"],
          },
        },
      ],
      dependencies: [],
      exports: [],
    },
    riskBuckets: { safeDelete: ["f1"], reviewFirst: [], doNotTouch: [] },
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

function task(overrides?: Partial<WorkflowA2ATask>): WorkflowA2ATask {
  return {
    taskId: "task_1",
    type: "cleanup_pr",
    status: "awaiting_payment",
    purchaseChannel: "direct_site",
    repository: {
      owner: "acme",
      name: "app",
      branch: "main",
      commitSha: "deadbeef01",
    },
    transitions: [],
    ...overrides,
  };
}

function byId(steps: ReturnType<typeof resolveWorkflowStepStates>) {
  return Object.fromEntries(steps.map((s) => [s.id, s]));
}

test("1. empty session: connect current, others locked, no completed steps", () => {
  const steps = resolveWorkflowStepStates({
    scanResult: null,
    scanComplete: false,
    findings: null,
  });
  const map = byId(steps);
  assert.equal(map.connect.status, "current");
  assert.equal(map.findings.status, "locked");
  assert.equal(map.cleanup_pr.status, "locked");
  assert.equal(map.review_accept.status, "locked");
  assert.ok(steps.every((s) => s.status !== "complete"));
});

test("2. URL typed but scan not started: still no completed step", () => {
  const steps = resolveWorkflowStepStates({
    scanResult: null,
    scanComplete: false,
    findings: null,
    activeTab: "scan",
  });
  assert.equal(byId(steps).connect.status, "current");
  assert.ok(steps.every((s) => s.status !== "complete"));
});

test("3. scan running: connect running, findings locked", () => {
  const steps = resolveWorkflowStepStates({
    scanResult: null,
    scanComplete: false,
    findings: null,
    scanPhase: "running",
  });
  const map = byId(steps);
  assert.equal(map.connect.status, "running");
  assert.equal(map.findings.status, "locked");
});

test("4. scan failed: connect failed, findings locked", () => {
  const steps = resolveWorkflowStepStates({
    scanResult: null,
    scanComplete: false,
    findings: null,
    scanPhase: "failed",
  });
  const map = byId(steps);
  assert.equal(map.connect.status, "failed");
  assert.equal(map.findings.status, "locked");
});

test("5. successful scan: connect complete, findings current", () => {
  const s = scan();
  assert.equal(
    isRepositoryConnected({ scanResult: s, scanComplete: true, scanRecordId: s.id }),
    true
  );
  const steps = resolveWorkflowStepStates({
    scanResult: s,
    scanComplete: true,
    scanRecordId: s.id,
    projectRootConfirmed: true,
    findings: null,
  });
  const map = byId(steps);
  assert.equal(map.connect.status, "complete");
  assert.equal(map.findings.status, "current");
  assert.equal(map.cleanup_pr.status, "locked");
});

test("scan without commit SHA is not connected", () => {
  const s = scan({
    repo: {
      owner: "acme",
      name: "app",
      branch: "main",
      url: "https://github.com/acme/app",
      workspaceSource: "github_zip",
    } as ScanPayload["repo"],
  });
  assert.equal(
    isRepositoryConnected({ scanResult: s, scanComplete: true, scanRecordId: s.id }),
    false
  );
});

test("6. findings analysis running: findings running, no completion check", () => {
  const s = scan();
  const steps = resolveWorkflowStepStates({
    scanResult: s,
    scanComplete: true,
    scanRecordId: s.id,
    projectRootConfirmed: true,
    findings: null,
    findingsPhase: "running",
  });
  assert.equal(byId(steps).findings.status, "running");
  assert.notEqual(byId(steps).findings.status, "complete");
});

test("7. real findings complete only when bound and reviewed", () => {
  const s = scan();
  const f = findings();
  assert.equal(
    isFindingsBoundToActiveScan({
      scanResult: s,
      scanComplete: true,
      scanRecordId: s.id,
      findings: f,
    }),
    true
  );
  assert.equal(
    isFindingsStepComplete({
      scanResult: s,
      scanComplete: true,
      scanRecordId: s.id,
      findings: f,
      scopeReviewed: false,
    }),
    false
  );
  assert.equal(
    isFindingsStepComplete({
      scanResult: s,
      scanComplete: true,
      scanRecordId: s.id,
      findings: f,
      scopeReviewed: true,
    }),
    true
  );

  const incomplete = resolveWorkflowStepStates({
    scanResult: s,
    scanComplete: true,
    scanRecordId: s.id,
    findings: f,
    scopeReviewed: false,
  });
  assert.equal(byId(incomplete).findings.status, "current");

  const complete = resolveWorkflowStepStates({
    scanResult: s,
    scanComplete: true,
    scanRecordId: s.id,
    findings: f,
    scopeReviewed: true,
    selectedFindingIds: ["f1"],
  });
  assert.equal(byId(complete).findings.status, "complete");
});

test("8. stale findings from another repository are ignored", () => {
  const s = scan();
  const stale = findings({
    scanId: "scan_other",
    repo: { owner: "other", name: "repo", branch: "main", commitSha: "ffffff" },
  });
  assert.equal(
    isFindingsBoundToActiveScan({
      scanResult: s,
      scanComplete: true,
      scanRecordId: s.id,
      findings: stale,
    }),
    false
  );
  const steps = resolveWorkflowStepStates({
    scanResult: s,
    scanComplete: true,
    scanRecordId: s.id,
    findings: stale,
    scopeReviewed: true,
  });
  assert.notEqual(byId(steps).findings.status, "complete");
});

test("9. scope confirmed unlocks Create Cleanup PR", () => {
  const s = scan();
  const f = findings();
  const steps = resolveWorkflowStepStates({
    scanResult: s,
    scanComplete: true,
    scanRecordId: s.id,
    findings: f,
    scopeReviewed: true,
    selectedFindingIds: ["f1"],
  });
  const map = byId(steps);
  assert.equal(map.findings.status, "complete");
  assert.equal(map.cleanup_pr.status, "current");
});

test("10. payment made but no PR: Create Cleanup PR running, not complete", () => {
  const s = scan();
  const f = findings();
  const steps = resolveWorkflowStepStates({
    scanResult: s,
    scanComplete: true,
    scanRecordId: s.id,
    findings: f,
    scopeReviewed: true,
    selectedFindingIds: ["f1"],
    a2aTask: task({ status: "funded" }),
  });
  assert.equal(byId(steps).cleanup_pr.status, "running");
  assert.equal(isCleanupPrComplete({ scanResult: s, a2aTask: task({ status: "funded" }) }), false);
});

test("11. commit created but no PR: Create Cleanup PR not complete", () => {
  const s = scan();
  const t = task({
    status: "creating_branch",
    changes: { changedFiles: ["src/a.ts"], unifiedDiff: "diff" },
  });
  assert.equal(isCleanupPrComplete({ scanResult: s, a2aTask: t }), false);
  const steps = resolveWorkflowStepStates({
    scanResult: s,
    scanComplete: true,
    scanRecordId: s.id,
    findings: findings(),
    scopeReviewed: true,
    selectedFindingIds: ["f1"],
    a2aTask: t,
  });
  assert.notEqual(byId(steps).cleanup_pr.status, "complete");
});

test("12. real PR created: cleanup complete, review unlocked", () => {
  const s = scan();
  const t = task({
    status: "delivery_ready",
    pullRequest: {
      number: 42,
      url: "https://github.com/acme/app/pull/42",
      branch: "repodiet/cleanup",
    },
  });
  assert.equal(isCleanupPrComplete({ scanResult: s, a2aTask: t }), true);
  const steps = resolveWorkflowStepStates({
    scanResult: s,
    scanComplete: true,
    scanRecordId: s.id,
    findings: findings(),
    scopeReviewed: true,
    selectedFindingIds: ["f1"],
    a2aTask: t,
  });
  const map = byId(steps);
  assert.equal(map.cleanup_pr.status, "complete");
  assert.ok(map.review_accept.status === "current" || map.review_accept.status === "running");
});

test("13. checks pending: Review & Accept running/current, not complete", () => {
  const s = scan();
  const t = task({
    status: "monitoring_checks",
    pullRequest: {
      number: 42,
      url: "https://github.com/acme/app/pull/42",
    },
  });
  const steps = resolveWorkflowStepStates({
    scanResult: s,
    scanComplete: true,
    scanRecordId: s.id,
    findings: findings(),
    scopeReviewed: true,
    selectedFindingIds: ["f1"],
    a2aTask: t,
  });
  assert.equal(byId(steps).review_accept.status, "running");
  assert.equal(isReviewAcceptComplete({ scanResult: s, a2aTask: t }), false);
});

test("14. explicit accepted delivery: Review & Accept complete", () => {
  const s = scan();
  const t = task({
    status: "buyer_accepted",
    pullRequest: {
      number: 42,
      url: "https://github.com/acme/app/pull/42",
    },
    settlement: { buyerAcceptedAt: "2026-07-16T00:00:00.000Z" },
  });
  assert.equal(isReviewAcceptComplete({ scanResult: s, a2aTask: t }), true);
  const steps = resolveWorkflowStepStates({
    scanResult: s,
    scanComplete: true,
    scanRecordId: s.id,
    findings: findings(),
    scopeReviewed: true,
    selectedFindingIds: ["f1"],
    a2aTask: t,
  });
  assert.equal(byId(steps).review_accept.status, "complete");
});

test("15. repository identity change detaches stale findings completion", () => {
  const s = scan({
    id: "scan_new",
    repo: {
      owner: "acme",
      name: "new-app",
      branch: "main",
      url: "https://github.com/acme/new-app",
      commitSha: "1111111111",
    },
  });
  const oldFindings = findings({
    scanId: "scan_abc",
    repo: { owner: "acme", name: "app", branch: "main", commitSha: "deadbeef01" },
  });
  const steps = resolveWorkflowStepStates({
    scanResult: s,
    scanComplete: true,
    scanRecordId: s.id,
    findings: oldFindings,
    scopeReviewed: true,
    selectedFindingIds: ["f1"],
    a2aTask: task({
      pullRequest: { number: 1, url: "https://github.com/acme/app/pull/1" },
      status: "completed",
    }),
  });
  const map = byId(steps);
  assert.equal(map.connect.status, "complete");
  assert.notEqual(map.findings.status, "complete");
  assert.equal(map.cleanup_pr.status, "locked");
  assert.equal(map.review_accept.status, "locked");
});

test("16. refresh: inconsistent findings rejected from completion", () => {
  const s = scan();
  const mismatchedCommit = findings({
    repo: { owner: "acme", name: "app", branch: "main", commitSha: "0000000000" },
  });
  assert.equal(
    isFindingsBoundToActiveScan({
      scanResult: s,
      scanComplete: true,
      scanRecordId: s.id,
      findings: mismatchedCommit,
    }),
    false
  );
});

test("17. demo findings object alone never completes empty session", () => {
  const steps = resolveWorkflowStepStates({
    scanResult: null,
    scanComplete: false,
    findings: findings({ mode: "demo" as FindingsPayload["mode"] }),
  });
  assert.ok(steps.every((s) => s.status !== "complete"));
  assert.equal(byId(steps).connect.status, "current");
});

test("zero findings result can complete findings after real bound analysis", () => {
  const s = scan();
  const empty = findings({
    summary: {
      totalFindings: 0,
      duplicateClusters: 0,
      unusedFiles: 0,
      unusedDependencies: 0,
      unusedExports: 0,
      orphanPatterns: 0,
      slopSignals: 0,
      reviewRequired: 0,
      safeCandidates: 0,
      actionableFixes: 0,
      transformerCompatible: 0,
      dryRunPassed: 0,
      doNotTouch: 0,
    },
    unused: { files: [], dependencies: [], exports: [] },
  });
  assert.equal(
    isFindingsStepComplete({
      scanResult: s,
      scanComplete: true,
      scanRecordId: s.id,
      findings: empty,
      scopeReviewed: false,
    }),
    true
  );
});
