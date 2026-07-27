/**
 * Workflow tab ownership — the URL tab is the single source of truth for
 * which workbench stage may render.
 *
 * Regression context: page.tsx mounted the same UserDirectedWorkbench for
 * both the findings and patch tabs, differing only by an `initialStage`
 * seed, and the component then kept private `stage` state.
 * prepareAutomaticPlan() called setStage("plan"), so the Create Cleanup PR
 * / payment panel rendered while the URL still read tab=findings — payment
 * controls appearing inside Review Findings.
 *
 * These tests pin the ownership map so no stage can render under a tab that
 * does not own it.
 */
import assert from "node:assert/strict";
import { tabForStage } from "../src/components/app/user-directed-workbench";
import { resolveWorkflowStepStates } from "../src/lib/workflow/step-states";
import type { FindingsPayload } from "../src/lib/findings/types";
import type { ScanPayload } from "../src/lib/scanner/run-scan";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

function scan(): ScanPayload {
  return {
    id: "scan_abc",
    repo: {
      owner: "velz-cmd",
      name: "repodiet-e2e-test",
      branch: "main",
      url: "https://github.com/velz-cmd/repodiet-e2e-test",
      commitSha: "deadbeef01",
    },
    framework: { name: "Next.js", confidence: 1, signals: ["next"] },
    packageManager: "npm",
    summary: { totalFiles: 10, totalFolders: 3, totalSizeKb: 1, topExtensions: { ts: 10 } },
    topLevelFolders: [],
    configFiles: [],
    largestFiles: [],
    warnings: [],
  } as ScanPayload;
}

function findings(): FindingsPayload {
  return {
    scanId: "scan_abc",
    mode: "live",
    repo: { owner: "velz-cmd", name: "repodiet-e2e-test", branch: "main", commitSha: "deadbeef01" },
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
    artifacts: { findingsJson: true },
    rawToolReports: {
      knip: { status: "ok", source: "knip", sourceMode: "native", durationMs: 1 },
      jscpd: { status: "ok", source: "jscpd", sourceMode: "native", durationMs: 1 },
      madge: { status: "ok", source: "madge", sourceMode: "native", durationMs: 1 },
    },
  } as FindingsPayload;
}

function steps(overrides: Record<string, unknown>) {
  const all = resolveWorkflowStepStates({
    scanResult: scan(),
    scanComplete: true,
    scanRecordId: "scan_abc",
    findings: findings(),
    scopeReviewed: true,
    selectedFindingIds: ["f1"],
    ...overrides,
  });
  return Object.fromEntries(all.map((s) => [s.id, s]));
}

function run() {
  console.log("workbench-tab-ownership");

  // --- 1 & 2: findings can never own a payment/execution stage ----------

  test("1/2. the payment stage is owned by patch, never by findings", () => {
    assert.equal(tabForStage("pay"), "patch");
    assert.notEqual(tabForStage("pay"), "findings");
  });

  test("finding selection and cleanup-plan review are both owned by findings", () => {
    assert.equal(tabForStage("review"), "findings");
    assert.equal(tabForStage("plan"), "findings");
  });

  test("delivery review is owned by verify, never by findings or patch", () => {
    assert.equal(tabForStage("delivery"), "verify");
  });

  test("every stage maps to exactly one owning tab", () => {
    const stages = ["review", "plan", "pay", "delivery"] as const;
    for (const s of stages) {
      const owner = tabForStage(s);
      assert.ok(["findings", "patch", "verify"].includes(owner), `${s} -> ${owner}`);
    }
    // review/plan share findings; pay and delivery are exclusive.
    assert.notEqual(tabForStage("pay"), tabForStage("delivery"));
    assert.notEqual(tabForStage("pay"), tabForStage("review"));
  });

  // --- 3 & 4: patch unlock derives from authoritative plan state --------

  test("3. a current approved plan unlocks the patch tab", () => {
    const map = steps({ planApproved: true, planCurrent: true, githubWriteCapable: true });
    assert.equal(map.cleanup_pr.status, "current");
  });

  test("4. a superseded plan locks the patch tab", () => {
    const map = steps({ planApproved: true, planCurrent: false, githubWriteCapable: true });
    assert.equal(map.cleanup_pr.status, "locked");
  });

  test("5. the superseded lock explains that selections changed", () => {
    const map = steps({ planApproved: true, planCurrent: false, githubWriteCapable: true });
    assert.match(map.cleanup_pr.explanation ?? "", /selections changed/i);
  });

  test("an unapproved plan also locks the patch tab", () => {
    const map = steps({ planApproved: false, planCurrent: false, githubWriteCapable: true });
    assert.equal(map.cleanup_pr.status, "locked");
  });

  // --- 21: Review & Accept stays locked before real delivery ------------

  test("21. Review & Accept stays locked before a real PR and delivery exist", () => {
    const map = steps({ planApproved: true, planCurrent: true, githubWriteCapable: true });
    assert.equal(map.review_accept.status, "locked");
  });

  test("Review Findings is only complete once a current plan is approved", () => {
    const notApproved = steps({ planApproved: false, planCurrent: false });
    assert.notEqual(notApproved.findings.status, "complete");
    const approved = steps({ planApproved: true, planCurrent: true });
    assert.equal(approved.findings.status, "complete");
  });

  console.log("workbench-tab-ownership: all passed");
}

run();
