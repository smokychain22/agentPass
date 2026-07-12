import assert from "node:assert/strict";
import { computeRecallByRuleFamily } from "../src/lib/findings/recall-metrics";
import type { Finding } from "../src/lib/findings/types";
import type { DetectorRerunResult } from "../src/lib/verification/post-patch-verification";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

function finding(type: Finding["type"], id: string): Finding {
  return {
    id,
    type,
    title: "t",
    files: ["a.ts"],
    confidence: 0.8,
    confidenceReason: "x",
    severity: "low",
    action: "safe_candidate",
    reason: "x",
    source: "knip",
    sourceMode: "native",
    evidence: { summary: "x", signals: [] },
  };
}

console.log("recall-metrics");

test("computes per-family recall from reruns", () => {
  const applied = [finding("unused_import", "f1"), finding("unused_file", "f2")];
  const reruns: DetectorRerunResult[] = [
    { findingId: "f1", analyzer: "repodiet_import", passed: true, detail: "ok" },
    { findingId: "f2", analyzer: "knip", passed: false, detail: "still there" },
  ];
  const rows = computeRecallByRuleFamily(applied, reruns);
  const importRow = rows.find((r) => r.ruleFamily === "unused_import");
  const fileRow = rows.find((r) => r.ruleFamily === "unused_file");
  assert.equal(importRow?.recall, 1);
  assert.equal(fileRow?.recall, 0);
});

console.log("recall-metrics: all passed");
