import assert from "node:assert/strict";
import type { Finding } from "../src/lib/findings/types";
import { runEvidenceGate, computePriorityScore } from "../src/lib/findings/evidence-gate";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("evidence-gate");

function baseFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    type: "unused_file",
    title: "Unused file src/old.ts",
    files: ["src/old.ts"],
    confidence: 0.9,
    confidenceReason: "knip",
    severity: "medium",
    action: "safe_candidate",
    reason: "Knip reports file as unused",
    source: "knip",
    sourceMode: "native",
    evidence: {
      summary: "Unused file",
      signals: ["inbound_refs=0", "preflight=actionable_candidate"],
    },
    evidenceBundle: {
      analyzerEvidence: [],
      graphEvidence: [],
      frameworkEvidence: [],
      configurationEvidence: [],
      scriptEvidence: [],
      runtimeEvidence: [],
      gitEvidence: [],
      counterEvidence: [],
      unresolvedRisks: [],
      grade: "strong",
      classificationState: "supported",
      classificationLabel: "eligible_for_removal",
      decisionReason: "Strong evidence",
      autoFixAllowed: true,
    },
    ...overrides,
  };
}

test("verified tier when strong grade and multiple independent signals", () => {
  const gate = runEvidenceGate(baseFinding());
  assert.equal(gate.confidenceTier, "verified");
  assert.ok(gate.independentSignalCount >= 2);
  assert.ok(gate.pipelineStages.every((s) => s.name));
  assert.ok(gate.priorityScore > 0);
  assert.ok(gate.brief.falsePositiveRisks.length > 0);
});

test("needs_review when contradictory counter-evidence", () => {
  const gate = runEvidenceGate(
    baseFinding({
      evidenceBundle: {
        ...baseFinding().evidenceBundle!,
        grade: "contradictory",
        counterEvidence: [
          {
            channel: "configuration",
            source: "package.json",
            summary: "Listed in package exports",
            strength: "contradicting",
          },
        ],
      },
    })
  );
  assert.equal(gate.confidenceTier, "needs_review");
});

test("suppressed for protected findings", () => {
  const gate = runEvidenceGate(
    baseFinding({
      action: "do_not_touch",
      protected: true,
      classificationLabel: "protected",
    })
  );
  assert.equal(gate.confidenceTier, "suppressed");
});

test("priority score ranks verified above needs_review", () => {
  const verified = computePriorityScore(baseFinding(), "verified");
  const review = computePriorityScore(
    baseFinding({ action: "review_first", evidenceBundle: { ...baseFinding().evidenceBundle!, grade: "weak", autoFixAllowed: false } }),
    "needs_review"
  );
  assert.ok(verified.score > review.score);
});

console.log("evidence-gate: all passed");
