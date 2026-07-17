import assert from "node:assert/strict";
import {
  assertValidCleanupSelection,
  FindingSelectionValidationError,
  sanitizeSelectedFindingIds,
} from "../src/lib/findings/selection";
import {
  filterFindingsBySelection,
  filterFindingsByValidatedSelection,
} from "../src/lib/patch-kit/filter-findings";
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
    files: partial.files ?? ["src/archive/OldDashboard.backup.tsx"],
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
      commitSha: "abc123",
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
    duplicates: findings.filter((f) => f.type === "duplicate_code"),
    unused: {
      files: findings.filter((f) => f.type === "unused_file"),
      dependencies: findings.filter((f) => f.type === "unused_dependency"),
      exports: findings.filter((f) => f.type === "unused_export"),
    },
    orphans: findings.filter((f) => f.type === "orphan_pattern"),
    slopSignals: findings.filter((f) => f.type === "ai_slop_signal"),
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

const eligible = finding({
  id: "eligible-1",
  action: "safe_candidate",
  type: "unused_file",
  evidence: {
    summary: "backup",
    signals: ["classification=actionable_candidate", "unused"],
  },
});
const eligible2 = finding({
  id: "eligible-2",
  action: "safe_candidate",
  type: "unused_import",
  files: ["src/components/Dashboard.tsx"],
  evidence: {
    summary: "import",
    signals: [
      "classification=actionable_candidate",
      "symbol=Clock",
      "importLine=import { Clock } from 'lucide-react'",
    ],
  },
});
const review = finding({
  id: "review-1",
  action: "review_first",
  type: "unused_file",
  files: ["src/lib/unused-helper.ts"],
});
const protectedFinding = finding({
  id: "protected-1",
  action: "do_not_touch",
  type: "unused_file",
  files: ["src/app/page.tsx"],
  protected: true,
});

console.log("finding-selection");

test("one eligible row can be selected", () => {
  const selected = sanitizeSelectedFindingIds(
    [eligible, eligible2, review, protectedFinding],
    ["eligible-1"]
  );
  assert.deepEqual(selected, ["eligible-1"]);
  assert.equal(selected.length, 1);
});

test("review-first and protected IDs cannot enter selection", () => {
  const selected = sanitizeSelectedFindingIds(
    [eligible, review, protectedFinding],
    ["eligible-1", "review-1", "protected-1", "stale-id"]
  );
  assert.deepEqual(selected, ["eligible-1"]);
});

test("selected item survives pagination keying by finding id", () => {
  const all = [eligible, eligible2, review];
  const page1 = all.slice(0, 1);
  const page2 = all.slice(1);
  let selected = sanitizeSelectedFindingIds(all, ["eligible-1"]);
  assert.ok(page1.some((f) => selected.includes(f.id)));
  // Page 2 unmounts row 1 but selection remains keyed by id.
  selected = sanitizeSelectedFindingIds(all, selected);
  assert.deepEqual(selected, ["eligible-1"]);
  assert.ok(!page2.some((f) => f.id === "eligible-1"));
});

test("selected item survives collapse/expand identity", () => {
  let selected = ["eligible-2"];
  const collapsed: Finding[] = [];
  const expanded = [eligible, eligible2];
  selected = sanitizeSelectedFindingIds(expanded, selected);
  assert.deepEqual(selected, ["eligible-2"]);
  selected = sanitizeSelectedFindingIds([...collapsed, ...expanded], selected);
  assert.deepEqual(selected, ["eligible-2"]);
});

test("stale IDs are removed", () => {
  const selected = sanitizeSelectedFindingIds([eligible], ["eligible-1", "old-scan-finding"]);
  assert.deepEqual(selected, ["eligible-1"]);
});

test("bulk select keeps only eligible findings", () => {
  const findings = [eligible, eligible2, review, protectedFinding];
  const bulk = sanitizeSelectedFindingIds(
    findings,
    findings.map((f) => f.id)
  );
  assert.deepEqual(bulk.sort(), ["eligible-1", "eligible-2"]);
});

test("clear selection removes all", () => {
  assert.deepEqual(sanitizeSelectedFindingIds([eligible], []), []);
});

test("server rejects review-first selection", () => {
  const p = payload([eligible, review]);
  assert.throws(
    () => assertValidCleanupSelection({ findings: p, selectedFindingIds: ["review-1"] }),
    (err: unknown) =>
      err instanceof FindingSelectionValidationError && err.code === "FINDING_REVIEW_FIRST"
  );
});

test("server rejects unknown / stale finding ids", () => {
  const p = payload([eligible]);
  assert.throws(
    () => assertValidCleanupSelection({ findings: p, selectedFindingIds: ["missing"] }),
    (err: unknown) =>
      err instanceof FindingSelectionValidationError && err.code === "FINDING_UNKNOWN"
  );
});

test("server rejects cross-scan selection", () => {
  const p = payload([eligible]);
  assert.throws(
    () =>
      assertValidCleanupSelection({
        findings: p,
        selectedFindingIds: ["eligible-1"],
        expectedScanId: "scan_other",
      }),
    (err: unknown) =>
      err instanceof FindingSelectionValidationError && err.code === "FINDING_SCAN_MISMATCH"
  );
});

test("server rejects cross-repository selection", () => {
  const p = payload([eligible]);
  assert.throws(
    () =>
      assertValidCleanupSelection({
        findings: p,
        selectedFindingIds: ["eligible-1"],
        expectedRepository: { owner: "other", name: "repo" },
      }),
    (err: unknown) =>
      err instanceof FindingSelectionValidationError &&
      err.code === "FINDING_REPOSITORY_MISMATCH"
  );
});

test("validated filter accepts single eligible selection", () => {
  const p = payload([eligible, review]);
  const filtered = filterFindingsByValidatedSelection(p, ["eligible-1"]);
  assert.equal(filtered.unused.files.length, 1);
  assert.equal(filtered.unused.files[0]?.id, "eligible-1");
});

test("silent filter drops non-eligible ids", () => {
  const p = payload([eligible, review]);
  const filtered = filterFindingsBySelection(p, ["eligible-1", "review-1"]);
  assert.equal(filtered.unused.files.length, 1);
  assert.equal(filtered.unused.files[0]?.id, "eligible-1");
});

test("continue gate enables with exactly one valid selection", () => {
  const selectedCount = sanitizeSelectedFindingIds(
    [eligible, review],
    ["eligible-1"]
  ).length;
  const cleanupEligible = 1;
  const canContinue = selectedCount > 0 && cleanupEligible > 0;
  assert.equal(selectedCount, 1);
  assert.equal(canContinue, true);
});

console.log("finding-selection: all passed");
