import assert from "node:assert/strict";
import {
  FREE_CANDIDATE_ATTEMPT_LIMIT,
  FREE_RETAINED_FIX_LIMIT,
  MAX_STRATEGIES_PER_FINDING,
  QUICK_CLEANUP_RETAINED_FIX_LIMIT,
} from "../src/lib/execution/constants";
import {
  assertNoGenericSkippedLabel,
  buildNoSafeActionSummary,
  deriveAttemptProductOutcome,
  deriveRunFinalStatus,
  formatProductOutcomeLabel,
  PRODUCT_OUTCOME_LABELS,
} from "../src/lib/execution/outcomes";
import { formatRejectionReason } from "../src/lib/execution/candidate-decision";
import { listStrategiesForFinding } from "../src/lib/execution/fix-strategies";
import { classifyFindingActionability } from "../src/lib/cleanup/actionability";
import {
  detectUnusedImportsInSource,
  removeUnusedSymbolFromImport,
  convertSymbolToTypeOnlyImport,
} from "../src/lib/findings/unused-import-detector";
import type { Finding } from "../src/lib/findings/types";

function sampleImportFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f-import",
    type: "unused_import",
    title: "Unused import: Clock",
    files: ["src/x.tsx"],
    confidence: 0.9,
    confidenceReason: "parser",
    severity: "low",
    action: "safe_candidate",
    reason: "Symbol Clock is unused",
    source: "knip",
    sourceMode: "native",
    evidence: {
      summary: "unused Clock",
      signals: [
        "symbol=Clock",
        'importLine=import { Clock, Play } from "lucide-react";',
      ],
    },
    ...overrides,
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

console.log("Action-first cleanup tests");

test("limits: 1 retained, 5 candidates, 3 strategies per finding", () => {
  assert.equal(FREE_RETAINED_FIX_LIMIT, 1);
  assert.equal(FREE_CANDIDATE_ATTEMPT_LIMIT, 5);
  assert.equal(MAX_STRATEGIES_PER_FINDING, 3);
  assert.equal(QUICK_CLEANUP_RETAINED_FIX_LIMIT, 500);
});

test("retained attempt is generated_pending until repository verification completes", () => {
  const regression = deriveAttemptProductOutcome({
    internalStatus: "skipped",
    reason: "Verification introduced new failure in: typecheck",
    pluginId: "remove_unused_import",
    comparison: [{ name: "typecheck", outcome: "New regression" }],
  });
  assert.equal(regression, "rolled_back_regression");
  const retained = deriveAttemptProductOutcome({
    internalStatus: "retained",
    reason: "Fix verified and retained.",
    pluginId: "remove_unused_import",
  });
  assert.equal(retained, "generated_pending");
});

test("all five fail summary is explicit", () => {
  const summary = buildNoSafeActionSummary({
    evaluated: 5,
    retained: 0,
    outcomes: [
      "rolled_back_regression",
      "rolled_back_regression",
      "rolled_back_regression",
      "blocked_dynamic_usage",
      "blocked_protected_path",
    ],
  });
  assert.match(summary, /evaluated 5 candidates/i);
  assert.match(summary, /0 changes retained/i);
  assert.match(summary, /3 rejected by verification/i);
  assert.match(summary, /1 had unresolved dynamic usage/i);
  assert.match(summary, /1 belonged to a protected route/i);
  assert.match(summary, /No unsafe change was applied/i);
});

test("free proof retains maximum one fix via run final status", () => {
  assert.equal(
    deriveRunFinalStatus({ retainedCount: 1, attemptCount: 3, mode: "auto_fix" }),
    "verified_fix"
  );
  assert.equal(
    deriveRunFinalStatus({ retainedCount: 0, attemptCount: 5, mode: "auto_fix" }),
    "no_safe_action"
  );
});

test("unused named import removes only Clock", () => {
  const source = `import { Clock, Play } from "lucide-react";\n\nexport function X() { return <Play />; }\n`;
  const modified = removeUnusedSymbolFromImport(
    source,
    'import { Clock, Play } from "lucide-react";',
    "Clock"
  );
  assert.match(modified, /import \{ Play \} from "lucide-react"/);
  assert.doesNotMatch(modified, /Clock/);
});

test("JSX-used import Play is not flagged unused", () => {
  const source = `import { Clock, Play } from "lucide-react";\n\nexport function X() { return <Play />; }\n`;
  const found = detectUnusedImportsInSource("src/x.tsx", source);
  assert.ok(found.some((f) => f.symbol === "Clock"));
  assert.ok(!found.some((f) => f.symbol === "Play"));
});

test("type-only import conversion strategy", () => {
  const source = `import { clsx, ClassValue } from "clsx";\n\nexport function cn(...inputs: ClassValue[]) {\n  return clsx(inputs);\n}\n`;
  const modified = convertSymbolToTypeOnlyImport(
    source,
    'import { clsx, ClassValue } from "clsx";',
    "ClassValue"
  );
  assert.match(modified, /type ClassValue/);
});

test("side-effect import is protected from unused detection", () => {
  const source = `import "polyfill";\nconsole.log("x");\n`;
  assert.equal(detectUnusedImportsInSource("src/y.ts", source).length, 0);
});

test("unused import has multiple strategies", () => {
  const finding = sampleImportFinding();
  const strategies = listStrategiesForFinding(finding, "remove_unused_import");
  assert.ok(strategies.length >= 2);
  assert.equal(strategies[0].id, "remove_unused_named_specifier");
});

test("cross-project duplicate is guided repair not automatic", () => {
  const finding: Finding = {
    id: "dup",
    type: "duplicate_code",
    title: "Dup",
    files: ["apps/a/x.tsx", "src/x.tsx"],
    confidence: 0.9,
    confidenceReason: "test",
    severity: "medium",
    action: "review_first",
    reason: "dup",
    source: "jscpd",
    sourceMode: "native",
    evidence: { summary: "dup", signals: ["cross_project=true"] },
  };
  assert.equal(classifyFindingActionability(finding), "guided_repair");
});

test("pre-existing failure reason does not use generic skipped", () => {
  const reason = formatRejectionReason({
    status: "skipped",
    reason: "Verification introduced new failure in: build",
    productOutcome: "rolled_back_regression",
    comparison: [{ name: "build", outcome: "New regression" }],
    rollbackStatus: "completed",
  });
  assert.match(reason, /Rolled back/i);
  assert.equal(assertNoGenericSkippedLabel(reason), true);
});

test("user-facing product labels never contain generic Skipped", () => {
  for (const label of Object.values(PRODUCT_OUTCOME_LABELS)) {
    assert.equal(assertNoGenericSkippedLabel(label), true, `label failed: ${label}`);
  }
  assert.equal(
    assertNoGenericSkippedLabel(formatProductOutcomeLabel("no_safe_action")),
    true
  );
  assert.equal(
    assertNoGenericSkippedLabel(formatProductOutcomeLabel("verified_fix")),
    true
  );
});

test("run final status review plan maps to review_ready_change", () => {
  assert.equal(
    deriveRunFinalStatus({ retainedCount: 0, attemptCount: 0, mode: "review_plan" }),
    "review_ready_change"
  );
});

console.log("All action-first cleanup tests passed.");
