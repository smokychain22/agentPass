import assert from "node:assert/strict";
import {
  assertCleanupEligibleInvariant,
  countCleanupEligible,
  getCleanupEligibilitySignals,
  isCleanupEligible,
} from "../src/lib/findings/cleanup-eligibility";
import { classifyAction } from "../src/lib/findings/confidence-path-rules";
import { isOperationalScriptPath } from "../src/lib/findings/operational-file-protection";
import { DEEP_SCAN_STAGES, stagePercent } from "../src/lib/deep-scan/types";
import {
  createProgressToken,
  hashProgressToken,
  verifyProgressToken,
} from "../src/lib/github-actions/callback-auth";
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
    source: partial.source ?? "repodiet_import",
    sourceMode: partial.sourceMode ?? "native",
    evidence: {
      summary: "test",
      signals: partial.evidence?.signals ?? [
        "classification=actionable_candidate",
        "symbol=Clock",
        "importLine=import { Clock } from 'x'",
      ],
    },
    ...partial,
  };
}

console.log("findings-progress-and-eligibility");

test("progress stages include archive and analyzer-specific steps", () => {
  for (const stage of [
    "PREPARING_ARCHIVE",
    "DOWNLOADING_ARCHIVE",
    "ARCHIVE_READY",
    "RUNNING_JSCpd",
    "RUNNING_KNIP",
    "RUNNING_MADGE",
    "RUNNING_INTERNAL_HEURISTICS",
    "PERSISTING_RESULTS",
    "WORKER_STALLED",
  ] as const) {
    assert.ok(DEEP_SCAN_STAGES.includes(stage), stage);
    assert.ok(typeof stagePercent(stage) === "number");
  }
});

test("progress token hashes verify without exposing raw claim secrets", () => {
  const token = createProgressToken();
  const hash = hashProgressToken(token);
  assert.equal(verifyProgressToken(token, hash), true);
  assert.equal(verifyProgressToken("pt_wrong", hash), false);
  assert.equal(token.startsWith("pt_"), true);
});

test("canonical cleanup eligibility requires SAFE + preflight + not protected", () => {
  const eligible = finding({
    id: "ok",
    type: "unused_import",
    action: "safe_candidate",
    evidence: {
      summary: "t",
      signals: [
        "classification=actionable_candidate",
        "symbol=Clock",
        "importLine=import { Clock } from 'x'",
      ],
    },
  });
  const signals = getCleanupEligibilitySignals(eligible);
  assert.equal(signals.riskBucket, "SAFE");
  assert.equal(signals.transformerPreflightPassed, true);
  assert.equal(signals.isCleanupEligible, true);

  const reviewButActionable = finding({
    id: "review",
    type: "unused_import",
    action: "review_first",
    evidence: {
      summary: "t",
      signals: [
        "classification=actionable_candidate",
        "symbol=Clock",
        "importLine=import { Clock } from 'x'",
      ],
    },
  });
  assert.equal(isCleanupEligible(reviewButActionable), false);

  const safeNoPreflight = finding({
    id: "nopre",
    type: "unused_file",
    action: "safe_candidate",
    files: ["archive/old.ts"],
    evidence: { summary: "t", signals: ["classification=unsupported"] },
  });
  assert.equal(isCleanupEligible(safeNoPreflight), false);
});

test("summaryCleanupEligibleCount matches filtered records", () => {
  const findings: Finding[] = [
    finding({
      id: "1",
      type: "unused_import",
      action: "safe_candidate",
      evidence: {
        summary: "t",
        signals: [
          "classification=actionable_candidate",
          "symbol=A",
          "importLine=import { A } from 'x'",
        ],
      },
    }),
    finding({
      id: "2",
      type: "unused_import",
      action: "review_first",
      evidence: {
        summary: "t",
        signals: [
          "classification=actionable_candidate",
          "symbol=B",
          "importLine=import { B } from 'x'",
        ],
      },
    }),
    finding({
      id: "3",
      type: "unused_file",
      action: "safe_candidate",
      files: ["archive/old.ts"],
      evidence: { summary: "t", signals: ["classification=unsupported"] },
    }),
  ];
  const count = countCleanupEligible(findings);
  assertCleanupEligibleInvariant(count, findings);
  assert.equal(count, 1);
});

test("operational scripts are not auto-safe from Knip unused alone", () => {
  assert.equal(isOperationalScriptPath("scripts/sync-vercel-env.mjs"), true);
  assert.equal(isOperationalScriptPath("scripts/test-birdeye-delayed.mjs"), true);
  assert.equal(isOperationalScriptPath("scripts/vercel-preview-env.mjs"), true);
  assert.equal(isOperationalScriptPath("src/lib/utils.ts"), false);

  const action = classifyAction(["scripts/sync-vercel-env.mjs"], {
    type: "unused_file",
    source: "knip",
  });
  assert.equal(action, "review_first");
});

test("safe-candidate selection rows key enablement by finding id + preflight", () => {
  const { safeCandidateSelectionRows, isFindingCheckboxEnabled } = require(
    "../src/lib/findings/cleanup-eligibility"
  ) as typeof import("../src/lib/findings/cleanup-eligibility");
  const findings: Finding[] = [
    finding({
      id: "safe-eligible-a",
      type: "unused_file",
      action: "safe_candidate",
      source: "knip",
      sourceMode: "native",
      files: ["src/archive/OldDashboard.backup.tsx"],
      evidence: {
        summary: "backup",
        signals: ["classification=actionable_candidate", "unused", "inboundRefs=0"],
      },
    }),
    finding({
      id: "safe-eligible-b",
      type: "unused_import",
      action: "safe_candidate",
      source: "repodiet_import",
      sourceMode: "native",
      files: ["src/components/Dashboard.tsx"],
      evidence: {
        summary: "import",
        signals: [
          "classification=actionable_candidate",
          "symbol=Clock",
          "importLine=import { Clock } from 'lucide-react'",
        ],
      },
    }),
    finding({
      id: "safe-no-preflight",
      type: "unused_file",
      action: "safe_candidate",
      source: "knip",
      sourceMode: "native",
      files: ["src/lib/unused-helper.ts"],
      evidence: { summary: "t", signals: ["unused", "inboundRefs=0"] },
    }),
    finding({
      id: "review-1",
      type: "unused_file",
      action: "review_first",
      source: "knip",
      sourceMode: "native",
      files: ["src/lib/orphan-a.ts"],
      evidence: { summary: "t", signals: ["unused"] },
    }),
  ];
  const rows = safeCandidateSelectionRows(findings);
  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.filter((r) => r.enabled).map((r) => r.findingId).sort(),
    ["safe-eligible-a", "safe-eligible-b"]
  );
  assert.equal(isFindingCheckboxEnabled(findings[0]!), true);
  assert.equal(isFindingCheckboxEnabled(findings[2]!), false);
  assert.equal(isFindingCheckboxEnabled(findings[3]!), false);
  // Not derived from list index — reorder must not change enablement for an id.
  const reordered = [findings[2]!, findings[0]!, findings[1]!];
  const again = safeCandidateSelectionRows(reordered);
  assert.equal(again.find((r) => r.findingId === "safe-eligible-a")?.enabled, true);
  assert.equal(again.find((r) => r.findingId === "safe-no-preflight")?.enabled, false);
});

test("select-all eligibility excludes SAFE without preflight", () => {
  const findings: Finding[] = [
    finding({
      id: "eligible",
      type: "unused_import",
      action: "safe_candidate",
      evidence: {
        summary: "t",
        signals: [
          "classification=actionable_candidate",
          "symbol=X",
          "importLine=import { X } from 'y'",
        ],
      },
    }),
    finding({
      id: "safe-only",
      type: "unused_file",
      action: "safe_candidate",
      files: ["archive/tmp.ts"],
      evidence: { summary: "t", signals: ["unused"] },
    }),
  ];
  const selected = findings.filter(isCleanupEligible).map((f) => f.id);
  assert.deepEqual(selected, ["eligible"]);
});

console.log("findings-progress-and-eligibility: all passed");
