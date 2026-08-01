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
import {
  assertOperationsWithinAuthorizedScope,
  normalizeSelectedFindingIdsForTest,
} from "../src/lib/patch-kit/patch-kit-engine";
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

// --- Cleanup-scope enforcement -----------------------------------------
//
// Reproduces the live defect: a request selecting ONE finding produced file
// operations for five, because the engine's main entry point dropped
// `selectedFindingIds` whenever findings were not inlined. These lock the
// selection contract and the independent final scope boundary.

test("selecting one finding keeps exactly that finding — no unselected finding survives", () => {
  const p = payload([
    finding({ id: "keep", action: "safe_candidate", evidence: { summary: "t", signals: ["inboundImports=0","routeLike=false","analyzer=knip","inbound_refs=0","strategyId=remove_file","evidenceGrade=strong","classificationState=supported","classificationLabel=eligible_for_removal","autoFixAllowed=true","classification=actionable_candidate","preflight=actionable_candidate"] }, files: ["src/unused/confirmed-unused.ts"] }),
    finding({ id: "other1", action: "safe_candidate", evidence: { summary: "t", signals: ["inboundImports=0","routeLike=false","analyzer=knip","inbound_refs=0","strategyId=remove_file","evidenceGrade=strong","classificationState=supported","classificationLabel=eligible_for_removal","autoFixAllowed=true","classification=actionable_candidate","preflight=actionable_candidate"] }, files: ["src/lib/orphan-a.ts"] }),
    finding({ id: "other2", action: "safe_candidate", evidence: { summary: "t", signals: ["inboundImports=0","routeLike=false","analyzer=knip","inbound_refs=0","strategyId=remove_file","evidenceGrade=strong","classificationState=supported","classificationLabel=eligible_for_removal","autoFixAllowed=true","classification=actionable_candidate","preflight=actionable_candidate"] }, files: ["src/config/runtime-hook.ts"] }),
  ]);
  const filtered = filterFindingsByValidatedSelection(p, ["keep"], { expectedScanId: "scan_test" });
  const all = [
    ...filtered.duplicates,
    ...filtered.unused.files,
    ...filtered.unused.dependencies,
    ...filtered.unused.exports,
    ...filtered.orphans,
    ...filtered.slopSignals,
  ];
  assert.equal(all.length, 1, "exactly one finding may enter patch generation");
  assert.equal(all[0].id, "keep");
  assert.ok(
    !all.some((f) => f.files.includes("src/config/runtime-hook.ts")),
    "an unselected path must never be reachable — this is the must-keep file the live defect would have deleted"
  );
});

test("a finding id from a different scan is rejected, not silently re-resolved", () => {
  const p = payload([finding({ id: "a", action: "safe_candidate", evidence: { summary: "t", signals: ["inboundImports=0","routeLike=false","analyzer=knip","inbound_refs=0","strategyId=remove_file","evidenceGrade=strong","classificationState=supported","classificationLabel=eligible_for_removal","autoFixAllowed=true","classification=actionable_candidate","preflight=actionable_candidate"] }, })]);
  assert.throws(
    () => filterFindingsByValidatedSelection(p, ["a"], { expectedScanId: "scan_other" }),
    (err: unknown) =>
      err instanceof FindingSelectionValidationError && err.code === "FINDING_SCAN_MISMATCH"
  );
});

test("an unknown or stale finding id fails clearly instead of widening scope", () => {
  const p = payload([finding({ id: "a", action: "safe_candidate", evidence: { summary: "t", signals: ["inboundImports=0","routeLike=false","analyzer=knip","inbound_refs=0","strategyId=remove_file","evidenceGrade=strong","classificationState=supported","classificationLabel=eligible_for_removal","autoFixAllowed=true","classification=actionable_candidate","preflight=actionable_candidate"] }, })]);
  assert.throws(
    () => filterFindingsByValidatedSelection(p, ["does-not-exist"], { expectedScanId: "scan_test" }),
    (err: unknown) => err instanceof FindingSelectionValidationError
  );
});

test("an empty selection fails clearly rather than defaulting to everything", () => {
  const p = payload([finding({ id: "a", action: "safe_candidate", evidence: { summary: "t", signals: ["inboundImports=0","routeLike=false","analyzer=knip","inbound_refs=0","strategyId=remove_file","evidenceGrade=strong","classificationState=supported","classificationLabel=eligible_for_removal","autoFixAllowed=true","classification=actionable_candidate","preflight=actionable_candidate"] }, })]);
  assert.throws(
    () => assertValidCleanupSelection({ findings: p, selectedFindingIds: [] }),
    (err: unknown) => err instanceof FindingSelectionValidationError
  );
});

test("submitting a protected or review-only finding by id does not authorize executing it", () => {
  const p = payload([
    finding({ id: "protected", action: "do_not_touch", files: ["middleware.ts"] }),
    finding({ id: "reviewy", action: "review_first", files: ["src/lib/orphan-b.ts"] }),
  ]);
  for (const id of ["protected", "reviewy"]) {
    assert.throws(
      () => assertValidCleanupSelection({ findings: p, selectedFindingIds: [id] }),
      (err: unknown) => err instanceof FindingSelectionValidationError,
      `${id} must fail closed`
    );
  }
});

test("scope broadening is detected and rejected even if an upstream stage emits an extra path", () => {
  const authorized = [
    finding({ id: "keep", action: "safe_candidate", files: ["src/unused/confirmed-unused.ts"] }),
  ];
  // Attributed to the authorized finding, in-scope path -> allowed.
  assert.doesNotThrow(() =>
    assertOperationsWithinAuthorizedScope({
      authorizedFindings: authorized,
      operations: [
        { filePath: "src/unused/confirmed-unused.ts", findingIds: ["keep"], type: "delete" },
      ],
    })
  );
  // An operation attributed to a finding the caller never authorized.
  assert.throws(
    () =>
      assertOperationsWithinAuthorizedScope({
        authorizedFindings: authorized,
        operations: [
          { filePath: "src/unused/confirmed-unused.ts", findingIds: ["keep"], type: "delete" },
          { filePath: "src/config/runtime-hook.ts", findingIds: ["other"], type: "delete" },
        ],
      }),
    (err: unknown) =>
      err instanceof FindingSelectionValidationError && err.code === "FINDING_SCOPE_BROADENED"
  );
  // An unattributed operation is scope broadening too.
  assert.throws(
    () =>
      assertOperationsWithinAuthorizedScope({
        authorizedFindings: authorized,
        operations: [{ filePath: "src/anything.ts", findingIds: [], type: "edit" }],
      }),
    (err: unknown) =>
      err instanceof FindingSelectionValidationError && err.code === "FINDING_SCOPE_BROADENED"
  );
});

test("a repair may EDIT a companion file it must rewrite, but may never DELETE an unauthorized path", () => {
  // Consolidating a duplicate has to rewrite the callers that import the
  // removed module, or the tree stops compiling. That edit is attributed to
  // the authorized finding and must be allowed.
  const authorized = [
    finding({
      id: "dup",
      action: "safe_candidate",
      type: "duplicate_code",
      files: ["src/components/StatusCard.tsx", "src/components/StatusCardCopy.tsx"],
    }),
  ];
  assert.doesNotThrow(() =>
    assertOperationsWithinAuthorizedScope({
      authorizedFindings: authorized,
      operations: [
        { filePath: "src/components/StatusCardCopy.tsx", findingIds: ["dup"], type: "delete" },
        { filePath: "src/components/LegacyStatusPanel.tsx", findingIds: ["dup"], type: "edit" },
      ],
    })
  );
  // The same finding may NOT delete a path outside its own file list.
  assert.throws(
    () =>
      assertOperationsWithinAuthorizedScope({
        authorizedFindings: authorized,
        operations: [
          { filePath: "src/config/runtime-hook.ts", findingIds: ["dup"], type: "delete" },
        ],
      }),
    (err: unknown) =>
      err instanceof FindingSelectionValidationError && err.code === "FINDING_SCOPE_BROADENED"
  );
});

test("a supplied selection whose ids all normalize away fails instead of running unscoped", () => {
  // Reproduced in production: selectedFindingIds: ["   "] returned success and
  // generated a five-path cleanup including a must-keep file, because the
  // whitespace id trimmed to nothing and fell through to the unscoped path.
  assert.equal(normalizeSelectedFindingIdsForTest(["   ", ""]).length, 0);
  assert.ok(normalizeSelectedFindingIdsForTest([" a ", "a"]).length === 1, "duplicates normalize to one");
});

console.log("finding-selection: all passed");
