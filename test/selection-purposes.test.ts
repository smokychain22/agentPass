import assert from "node:assert/strict";
import {
  assertValidCleanupSelection,
  FindingSelectionValidationError,
  sanitizeSelectedFindingIds,
} from "../src/lib/findings/selection";
import {
  getFindingCheckboxState,
  offFilterCleanupSelectionMessage,
  reviewSelectionCanTriggerCleanup,
  runReviewSelectionAction,
  sanitizeInspectionSelectedFindingIds,
  sanitizeReviewSelectedFindingIds,
  selectionPurposeOf,
} from "../src/lib/findings/selection-purposes";
import type { Finding, FindingsPayload } from "../src/lib/findings/types";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

function finding(partial: Partial<Finding> & Pick<Finding, "id" | "action">): Finding {
  return {
    title: partial.title ?? partial.id,
    type: partial.type ?? "unused_file",
    files: partial.files ?? ["src/unused/empty-module.ts"],
    confidence: 0.95,
    confidenceReason: "test",
    severity: "low",
    reason: "test",
    source: "knip",
    sourceMode: "native",
    evidence: {
      summary: "test",
      signals:
        partial.evidence?.signals ??
        (partial.action === "safe_candidate"
          ? ["classification=actionable_candidate", "unused"]
          : ["unused"]),
    },
    ...partial,
  };
}

function payload(findings: Finding[]): FindingsPayload {
  return {
    scanId: "scan_test",
    mode: "live",
    repo: {
      owner: "velz-cmd",
      name: "repodiet-e2e-test",
      url: "https://github.com/velz-cmd/repodiet-e2e-test",
      branch: "main",
      commitSha: "c0838e4cda326098a363b44e0e3ebe98e81e9463",
    },
    summary: {
      totalFindings: findings.length,
      duplicateClusters: 0,
      unusedFiles: findings.filter((f) => f.type === "unused_file").length,
      unusedDependencies: 0,
      unusedExports: 0,
      orphanPatterns: 0,
      slopSignals: 0,
      reviewRequired: findings.filter((f) => f.action === "review_first").length,
      safeCandidates: findings.filter((f) => f.action === "safe_candidate").length,
      doNotTouch: findings.filter((f) => f.action === "do_not_touch").length,
      eligibleFindings: findings.filter((f) =>
        f.evidence.signals.includes("classification=actionable_candidate")
      ).length,
    },
    duplicates: [],
    unused: {
      files: findings.filter((f) => f.type === "unused_file"),
      dependencies: [],
      exports: [],
    },
    orphans: findings.filter((f) => f.type === "orphan_pattern"),
    slopSignals: [],
    riskBuckets: {
      safeDelete: findings.filter((f) => f.action === "safe_candidate").map((f) => f.id),
      reviewFirst: findings.filter((f) => f.action === "review_first").map((f) => f.id),
      doNotTouch: findings.filter((f) => f.action === "do_not_touch").map((f) => f.id),
    },
    artifacts: { findingsJson: true },
    rawToolReports: {
      knip: { status: "ok", source: "knip", sourceMode: "native", durationMs: 1 },
      jscpd: { status: "ok", source: "jscpd", sourceMode: "native", durationMs: 1 },
      madge: { status: "ok", source: "madge", sourceMode: "native", durationMs: 1 },
    },
  };
}

console.log("selection-purposes");

const safe = finding({
  id: "fnd_safe",
  action: "safe_candidate",
  files: ["src/archive/OldDashboard.backup.tsx"],
  title: "Unused file",
  evidence: {
    summary: "backup",
    signals: ["classification=actionable_candidate", "unused", "inboundRefs=0"],
  },
});
const review = finding({
  id: "fnd_review",
  action: "review_first",
  files: ["src/lib/maybe-used.ts"],
  title: "Needs review",
});
const protectedFinding = finding({
  id: "fnd_protected",
  action: "do_not_touch",
  protected: true,
  files: ["src/app/page.tsx"],
  title: "Protected",
});
const findings = [safe, review, protectedFinding];

test("SAFE checkbox selects cleanup purpose", () => {
  assert.equal(selectionPurposeOf(safe), "cleanup");
  const state = getFindingCheckboxState(safe);
  assert.equal(state.enabled, true);
  assert.equal(state.purpose, "cleanup");
  assert.match(state.ariaLabel, /cleanup/i);
  const cleanupIds = sanitizeSelectedFindingIds(findings, [safe.id, review.id]);
  assert.deepEqual(cleanupIds, [safe.id]);
});

test("REVIEW FIRST checkbox selects review purpose and is enabled", () => {
  assert.equal(selectionPurposeOf(review), "review");
  const state = getFindingCheckboxState(review);
  assert.equal(state.enabled, true);
  assert.equal(state.purpose, "review");
  assert.equal(state.ariaLabel, "Select for deeper review");
  const reviewIds = sanitizeReviewSelectedFindingIds(findings, [review.id, safe.id]);
  assert.deepEqual(reviewIds, [review.id]);
});

test("DO NOT TOUCH selects inspection purpose only", () => {
  assert.equal(selectionPurposeOf(protectedFinding), "inspection");
  const state = getFindingCheckboxState(protectedFinding);
  assert.equal(state.enabled, true);
  assert.equal(state.purpose, "inspection");
  const inspectionIds = sanitizeInspectionSelectedFindingIds(findings, [
    protectedFinding.id,
    review.id,
  ]);
  assert.deepEqual(inspectionIds, [protectedFinding.id]);
});

test("cleanup and review state remain separate", () => {
  const cleanupIds = sanitizeSelectedFindingIds(findings, [safe.id]);
  const reviewIds = sanitizeReviewSelectedFindingIds(findings, [review.id]);
  assert.deepEqual(cleanupIds, [safe.id]);
  assert.deepEqual(reviewIds, [review.id]);
  assert.ok(!cleanupIds.includes(review.id));
  assert.ok(!reviewIds.includes(safe.id));
});

test("review selection never enables Quick Cleanup by itself", () => {
  assert.equal(reviewSelectionCanTriggerCleanup([review.id], []), false);
  assert.equal(reviewSelectionCanTriggerCleanup([review.id], [safe.id]), true);
  assert.equal(reviewSelectionCanTriggerCleanup([], [safe.id]), true);
});

test("clearing review does not clear cleanup (independent arrays)", () => {
  const cleanupIds = [safe.id];
  let reviewIds = [review.id];
  const cleared = runReviewSelectionAction("clear", reviewIds);
  reviewIds = cleared.reviewSelectedFindingIds;
  assert.deepEqual(reviewIds, []);
  assert.deepEqual(cleanupIds, [safe.id]);
  assert.equal(cleared.repositoryWritePerformed, false);
});

test("review actions never write to the repository", () => {
  for (const action of ["deeper_verification", "review_queue", "clear"] as const) {
    const result = runReviewSelectionAction(action, [review.id]);
    assert.equal(result.repositoryWritePerformed, false);
  }
});

test("off-filter cleanup selection message for Review First filter", () => {
  const msg = offFilterCleanupSelectionMessage({
    activeBucket: "review_first",
    cleanupSelectedIds: [safe.id],
    findings,
    visibleFindingIds: new Set([review.id]),
  });
  assert.equal(msg, "1 cleanup finding selected outside the current Review First filter");
});

test("server rejects review IDs submitted to cleanup", () => {
  assert.throws(
    () =>
      assertValidCleanupSelection({
        findings: payload(findings),
        selectedFindingIds: [review.id],
      }),
    (err: unknown) =>
      err instanceof FindingSelectionValidationError && err.code === "FINDING_REVIEW_FIRST"
  );
  assert.throws(
    () =>
      assertValidCleanupSelection({
        findings: payload(findings),
        selectedFindingIds: [protectedFinding.id],
      }),
    (err: unknown) =>
      err instanceof FindingSelectionValidationError && err.code === "FINDING_PROTECTED"
  );
});

test("server accepts cleanup-eligible SAFE ID only", () => {
  const accepted = assertValidCleanupSelection({
    findings: payload(findings),
    selectedFindingIds: [safe.id],
  });
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].id, safe.id);
});

console.log("selection-purposes: ok");
