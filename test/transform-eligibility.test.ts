import assert from "node:assert/strict";
import {
  isPhase1StructuralCandidate,
  resolvePhase1Plugin,
} from "../src/lib/execution/fix-plugins/phase1-plugins";
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

function unusedImportFinding(action: Finding["action"]): Finding {
  return {
    id: "f1",
    type: "unused_import",
    title: "Unused import: Clock",
    files: ["src/Dashboard.tsx"],
    confidence: 0.9,
    confidenceReason: "test",
    severity: "low",
    action,
    reason: "unused",
    source: "repodiet_import",
    sourceMode: "native",
    evidence: {
      summary: "test",
      signals: [
        "symbol=Clock",
        "importLine=import { Clock } from 'lucide-react'",
        "classification=actionable_candidate",
        "preflight=actionable_candidate",
      ],
    },
  };
}

console.log("transform-eligibility");

test("allows structural transform when preflight passed but action is review_first", () => {
  const finding = unusedImportFinding("review_first");
  assert.equal(isPhase1StructuralCandidate(finding), true);
  assert.notEqual(resolvePhase1Plugin(finding).id, "review_only");
});

test("blocks do_not_touch findings", () => {
  const finding = unusedImportFinding("do_not_touch");
  assert.equal(isPhase1StructuralCandidate(finding), false);
});

console.log("transform-eligibility: all passed");
