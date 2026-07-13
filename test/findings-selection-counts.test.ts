import assert from "node:assert/strict";
import { matchesBucket, matchesCategory } from "../src/components/app/findings/findings-workspace";
import { computeCanonicalStats } from "../src/lib/findings/stats";
import type { Finding } from "../src/lib/findings/types";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

function finding(partial: Partial<Finding> & Pick<Finding, "id" | "type" | "action">): Finding {
  return {
    title: partial.title ?? partial.id,
    files: partial.files ?? ["src/a.ts"],
    confidence: partial.confidence ?? 0.9,
    confidenceReason: "test",
    severity: partial.severity ?? "low",
    reason: "test",
    source: partial.source ?? "knip",
    sourceMode: "native",
    evidence: { summary: "test", signals: ["unused"] },
    ...partial,
  };
}

console.log("findings-selection-counts");

test("category and bucket counts sum from the same finding list", () => {
  const findings: Finding[] = [
    finding({ id: "1", type: "unused_file", action: "safe_candidate" }),
    finding({ id: "2", type: "unused_import", action: "safe_candidate" }),
    finding({ id: "3", type: "duplicate_code", action: "review_first" }),
    finding({ id: "4", type: "ai_slop_signal", action: "do_not_touch" }),
    finding({ id: "5", type: "unused_dependency", action: "review_first" }),
  ];

  const all = findings.filter((f) => matchesCategory(f, "all")).length;
  const dead = findings.filter((f) => matchesCategory(f, "dead_files")).length;
  const dups = findings.filter((f) => matchesCategory(f, "duplicates")).length;
  const deps = findings.filter((f) => matchesCategory(f, "dependencies")).length;
  const slop = findings.filter((f) => matchesCategory(f, "slop")).length;
  const safe = findings.filter((f) => matchesBucket(f, "safe_candidate")).length;
  const review = findings.filter((f) => matchesBucket(f, "review_first")).length;
  const protectedCount = findings.filter((f) => matchesBucket(f, "do_not_touch")).length;

  assert.equal(all, 5);
  assert.equal(dead, 2); // unused_file + unused_import
  assert.equal(dups, 1);
  assert.equal(deps, 1);
  assert.equal(slop, 1);
  assert.equal(safe + review + protectedCount, all);

  const stats = computeCanonicalStats(findings);
  assert.equal(stats.totalFindings, all);
  assert.equal(
    stats.safeCandidateCount + stats.reviewFirstCount + stats.doNotTouchCount,
    stats.totalFindings
  );
});

test("unused_import is included in unusedExports canonical bucket for summary math", () => {
  const findings: Finding[] = [
    finding({ id: "e1", type: "unused_export", action: "safe_candidate" }),
    finding({ id: "i1", type: "unused_import", action: "safe_candidate" }),
  ];
  const stats = computeCanonicalStats(findings);
  assert.equal(stats.unusedExportCount, 2);
  assert.equal(
    stats.duplicateCount +
      stats.unusedFileCount +
      stats.unusedDependencyCount +
      stats.unusedExportCount +
      stats.orphanCount +
      stats.slopSignalCount,
    stats.totalFindings
  );
});

console.log("findings-selection-counts: all passed");
