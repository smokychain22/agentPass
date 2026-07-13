import assert from "node:assert/strict";
import type { Finding } from "../src/lib/findings/types";
import {
  assertQuickTriageSummaryInvariants,
  buildQuickTriageResult,
} from "../src/lib/a2mcp/quick-triage-response";
import type { FindingsPayload } from "../src/lib/findings/types";

function sampleFinding(
  id: string,
  action: Finding["action"],
  priorityScore: number
): Finding {
  return {
    id,
    type: "unused_file",
    title: `Finding ${id}`,
    action,
    confidence: 0.8,
    confidenceReason: "test fixture",
    severity: "medium",
    reason: "test fixture",
    files: [`src/${id}.ts`],
    source: "knip",
    sourceMode: "native",
    evidence: { summary: `Evidence for ${id}`, signals: [] },
    priorityScore,
  };
}

function samplePayload(findings: Finding[]): FindingsPayload {
  return {
    scanId: "scan_test",
    repo: { owner: "acme", name: "repo", branch: "main", commitSha: "abc123" },
    summary: {
      totalFindings: findings.length,
      duplicateClusters: 0,
      unusedFiles: findings.length,
      unusedDependencies: 0,
      unusedExports: 0,
      orphanPatterns: 0,
      slopSignals: 0,
      reviewRequired: findings.filter((f) => f.action === "review_first").length,
      safeCandidates: findings.filter((f) => f.action === "safe_candidate").length,
      doNotTouch: findings.filter((f) => f.action === "do_not_touch").length,
    },
    duplicates: [],
    unused: { files: findings, dependencies: [], exports: [] },
    orphans: [],
    slopSignals: [],
    riskBuckets: {
      safeDelete: findings.filter((f) => f.action === "safe_candidate").map((f) => f.id),
      reviewFirst: findings.filter((f) => f.action === "review_first").map((f) => f.id),
      doNotTouch: findings.filter((f) => f.action === "do_not_touch").map((f) => f.id),
    },
    artifacts: { findingsJson: true },
    mode: "live",
    rawToolReports: {
      knip: { status: "ok", source: "knip", sourceMode: "native", durationMs: 1 },
      jscpd: { status: "ok", source: "jscpd", sourceMode: "native", durationMs: 1 },
      madge: { status: "ok", source: "madge", sourceMode: "native", durationMs: 1 },
    },
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

async function run() {
  console.log("quick-triage-response");

  const fortyFindings = Array.from({ length: 40 }, (_, i) =>
    sampleFinding(
      `f${i}`,
      i === 0 ? "safe_candidate" : "review_first",
      100 - i
    )
  );

  for (const limit of [1, 5, 10] as const) {
    test(`limits returned findings to ${limit}`, () => {
      const result = buildQuickTriageResult(samplePayload(fortyFindings), limit);
      assert.equal(result.summary.totalFindingsDetected, 40);
      assert.equal(result.summary.findingsReturned, limit);
      assert.equal(result.findings.length, limit);
      assert.equal(result.internalScan.totalFindings, 40);
      assertQuickTriageSummaryInvariants(result);
    });
  }

  test("returned category counts add up to findingsReturned", () => {
    const result = buildQuickTriageResult(samplePayload(fortyFindings), 5);
    const bucketSum =
      result.summary.safeCandidates +
      result.summary.reviewFirst +
      result.summary.protected;
    assert.equal(bucketSum, result.summary.findingsReturned);
    assert.equal(result.summary.safeCandidates, 1);
    assert.equal(result.summary.reviewFirst, 4);
    assert.equal(result.summary.protected, 0);
  });

  test("internal scan preserves full counts separately from returned summary", () => {
    const result = buildQuickTriageResult(samplePayload(fortyFindings), 5);
    assert.equal(result.internalScan.totalFindings, 40);
    assert.equal(result.internalScan.riskBuckets.safeCandidates, 1);
    assert.equal(result.internalScan.riskBuckets.reviewFirst, 39);
    assert.equal(
      result.internalScan.riskBuckets.safeCandidates +
        result.internalScan.riskBuckets.reviewFirst +
        result.internalScan.riskBuckets.protected,
      40
    );
  });

  test("returns highest-priority findings first", () => {
    const result = buildQuickTriageResult(samplePayload(fortyFindings), 3);
    assert.deepEqual(
      result.findings.map((f) => f.id),
      ["f0", "f1", "f2"]
    );
  });

  console.log("quick-triage-response: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
