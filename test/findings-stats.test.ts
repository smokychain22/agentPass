/**
 * Findings stats invariant tests (offline).
 */
import assert from "node:assert/strict";
import {
  assertFindingsInvariants,
  buildSummaryFromFindings,
  computeCanonicalStats,
  metricLabel,
  analyzerSourceLabel,
} from "../src/lib/findings/stats";
import type { Finding, FindingsPayload, ToolRunReport } from "../src/lib/findings/types";

function finding(partial: Partial<Finding> & Pick<Finding, "id" | "type" | "action">): Finding {
  return {
    title: partial.title ?? partial.type,
    files: partial.files ?? ["src/example.ts"],
    confidence: partial.confidence ?? 0.8,
    confidenceReason: "test",
    severity: "medium",
    reason: "test",
    source: partial.source ?? "knip_fallback",
    sourceMode: partial.sourceMode ?? "fallback",
    evidence: { summary: "test", signals: [] },
    ...partial,
  };
}

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

function mockPayload(findings: Finding[]): FindingsPayload {
  const summary = buildSummaryFromFindings(findings);
  return {
    scanId: "scan_test",
    repo: { owner: "o", name: "r", branch: "main" },
    summary,
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
    mode: "live",
    rawToolReports: {
      knip: { status: "fallback", source: "internal_import_graph", sourceMode: "fallback", durationMs: 1 },
      jscpd: { status: "fallback", source: "internal_duplicate_detector", sourceMode: "fallback", durationMs: 1 },
      madge: { status: "fallback", source: "internal_dependency_graph", sourceMode: "fallback", durationMs: 1 },
    },
  };
}

console.log("Findings stats tests");

test("summary total equals findings list total", () => {
  const findings = [
    finding({ id: "f1", type: "duplicate_code", action: "review_first" }),
    finding({ id: "f2", type: "unused_file", action: "review_first" }),
    finding({ id: "f3", type: "unused_export", action: "do_not_touch" }),
  ];
  const payload = mockPayload(findings);
  assert.equal(payload.summary.totalFindings, findings.length);
  assertFindingsInvariants(payload);
});

test("bucket totals equal overall total", () => {
  const findings = [
    finding({ id: "f1", type: "duplicate_code", action: "review_first" }),
    finding({ id: "f2", type: "unused_file", action: "safe_candidate" }),
    finding({ id: "f3", type: "orphan_pattern", action: "do_not_touch" }),
  ];
  const stats = computeCanonicalStats(findings);
  assert.equal(
    stats.reviewFirstCount + stats.safeCandidateCount + stats.doNotTouchCount,
    stats.totalFindings
  );
});

test("fallback labels appear correctly", () => {
  const report: ToolRunReport = {
    status: "fallback",
    source: "internal_import_graph",
    sourceMode: "fallback",
    durationMs: 10,
  };
  const label = metricLabel("unusedFiles", report);
  assert.match(label.title, /Potentially Unreferenced/);
  const source = analyzerSourceLabel(report);
  assert.equal(source.mode, "Fallback");
});

test("native labels appear correctly", () => {
  const report: ToolRunReport = {
    status: "ok",
    source: "jscpd",
    sourceMode: "native",
    durationMs: 10,
  };
  const label = metricLabel("duplicates", report);
  assert.equal(label.title, "Duplicate Clusters");
  const source = analyzerSourceLabel(report);
  assert.equal(source.mode, "Native");
  assert.equal(source.name, "jscpd");
});

console.log("\nAll findings stats tests passed.");
