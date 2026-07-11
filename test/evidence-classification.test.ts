import assert from "node:assert/strict";
import { decideClassification } from "../src/lib/evidence/decision-matrix";
import type { Finding } from "../src/lib/findings/types";
import type { EvidenceItem, ReferenceChannelStatus } from "../src/lib/evidence/types";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

function baseFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f_test",
    type: "unused_file",
    title: "Test finding",
    files: ["src/lib/helpers.ts"],
    confidence: 0.9,
    confidenceReason: "test",
    severity: "low",
    action: "review_first",
    reason: "No inbound imports",
    source: "knip",
    sourceMode: "native",
    evidence: {
      summary: "Unused file",
      signals: ["inbound_refs=0"],
    },
    ...overrides,
  };
}

const emptyChannels: ReferenceChannelStatus = {
  staticImports: true,
  dynamicImports: true,
  configuration: true,
  scripts: true,
  packageExports: true,
  frameworkEntryPoint: false,
  incomplete: [],
};

function decide(
  finding: Finding,
  counterEvidence: EvidenceItem[] = [],
  channels: ReferenceChannelStatus = emptyChannels,
  extras: Partial<Parameters<typeof decideClassification>[0]> = {}
) {
  return decideClassification({
    finding,
    counterEvidence,
    channels,
    hasPreflightActionable: false,
    transformerAvailable: true,
    actionable: true,
    ...extras,
  });
}

console.log("evidence-classification");

test("blocks protected route paths with do_not_touch", () => {
  const finding = baseFinding({
    files: ["app/api/users/route.ts"],
    protected: true,
  });
  const result = decide(finding, [
    {
      channel: "framework",
      source: "protected_path_rules",
      summary: "Path matches protected route/config pattern.",
      strength: "contradicting",
    },
  ]);
  assert.equal(result.action, "do_not_touch");
  assert.equal(result.classificationLabel, "protected");
  assert.equal(result.autoFixAllowed, false);
});

test("downgrades fallback orphan to review_first with contradictory grade", () => {
  const finding = baseFinding({
    type: "orphan_pattern",
    source: "madge_fallback",
    sourceMode: "fallback",
    files: ["src/orphan-island.ts"],
  });
  const result = decide(
    finding,
    [
      {
        channel: "counter",
        source: "madge_fallback",
        summary: "Orphan signal from fallback graph only",
        strength: "contradicting",
      },
    ],
    {
      ...emptyChannels,
      incomplete: ["native_graph_unreachable"],
    }
  );
  assert.equal(result.grade, "contradictory");
  assert.equal(result.action, "review_first");
  assert.equal(result.classificationLabel, "review_required");
  assert.equal(result.autoFixAllowed, false);
});

test("allows strong unused import with preflight as safe_candidate", () => {
  const finding = baseFinding({
    type: "unused_import",
    files: ["src/app.tsx"],
    evidence: {
      summary: "Unused import",
      signals: ["symbol=useMemo", "preflight=actionable_candidate"],
    },
  });
  const result = decide(finding, [], emptyChannels, {
    hasPreflightActionable: true,
    actionable: true,
    transformerAvailable: true,
  });
  assert.equal(result.grade, "strong");
  assert.equal(result.action, "safe_candidate");
  assert.equal(result.classificationLabel, "unused_import_confirmed");
  assert.equal(result.autoFixAllowed, true);
});

test("never auto-fixes unused_file without strong native evidence", () => {
  const finding = baseFinding({
    source: "knip_fallback",
    sourceMode: "fallback",
  });
  const result = decide(finding);
  assert.equal(result.grade, "insufficient");
  assert.equal(result.action, "review_first");
  assert.equal(result.classificationLabel, "review_required");
  assert.equal(result.autoFixAllowed, false);
});

test("blocks deletion when package.json exports contradict", () => {
  const finding = baseFinding({
    evidence: { summary: "Unused", signals: ["inbound_refs=0"] },
  });
  const result = decide(finding, [
    {
      channel: "counter",
      source: "package.json",
      summary: "File appears in package.json exports or entry fields.",
      strength: "contradicting",
    },
  ]);
  assert.equal(result.grade, "contradictory");
  assert.equal(result.action, "review_first");
  assert.equal(result.autoFixAllowed, false);
});

test("keeps near duplicates review-first even with native analyzer", () => {
  const finding = baseFinding({
    type: "duplicate_code",
    files: ["src/a.ts", "src/b.ts"],
    evidence: {
      summary: "Similar code",
      signals: ["similarity=0.82"],
    },
  });
  const result = decide(finding, [], emptyChannels, {
    hasPreflightActionable: true,
  });
  assert.equal(result.classificationLabel, "near_duplicate");
  assert.equal(result.action, "review_first");
  assert.equal(result.autoFixAllowed, false);
});

test("never auto-deletes unused dependencies", () => {
  const finding = baseFinding({
    type: "unused_dependency",
    packageName: "lodash",
    files: [],
    evidence: { summary: "Unused dep", signals: [] },
  });
  const result = decide(finding, [], emptyChannels, {
    hasPreflightActionable: true,
  });
  assert.equal(result.grade, "moderate");
  assert.equal(result.action, "review_first");
  assert.equal(result.autoFixAllowed, false);
});

console.log("evidence-classification: all passed");
