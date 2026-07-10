import assert from "node:assert/strict";
import { isEligibleFinding, isTransformedFinding, isActionableFinding } from "../src/lib/findings/actionability-signals";
import { applyStrictFindingsMode } from "../src/lib/findings/strict-findings";
import { filterProductFindings, isKnipAvailable } from "../src/lib/findings/analyzer-availability";
import { summarizeCleanupAttempts } from "../src/lib/execution/candidate-lifecycle";
import { computeWorkflowGates } from "../src/lib/workflow/gates";
import type { Finding, FindingsPayload, ToolRunReport } from "../src/lib/findings/types";
import type { PatchKitPayload } from "../src/lib/patch-kit/types";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

function baseReport(status: ToolRunReport["status"], sourceMode: ToolRunReport["sourceMode"]): ToolRunReport {
  return {
    status,
    source: status === "ok" ? "knip" : "internal_import_graph",
    sourceMode,
    durationMs: 10,
  };
}

function fallbackFinding(): Finding {
  return {
    id: "f1",
    type: "unused_file",
    title: "Fallback unused",
    files: ["src/old.ts"],
    confidence: 0.8,
    confidenceReason: "fallback",
    severity: "low",
    action: "safe_candidate",
    reason: "fallback",
    source: "knip_fallback",
    sourceMode: "fallback",
    evidence: { summary: "x", signals: [] },
  };
}

function nativeDuplicate(): Finding {
  return {
    id: "f2",
    type: "duplicate_code",
    title: "Dup",
    files: ["a.ts", "b.ts"],
    confidence: 0.9,
    confidenceReason: "native",
    severity: "medium",
    action: "review_first",
    reason: "dup",
    source: "jscpd",
    sourceMode: "native",
    evidence: { summary: "x", signals: [] },
  };
}

function run() {
  console.log("Strict mode tests");

  test("fallback findings excluded from product totals", () => {
    const reports = {
      knip: baseReport("fallback", "fallback"),
      jscpd: { ...baseReport("ok", "native"), source: "jscpd" as const },
      madge: { ...baseReport("fallback", "fallback"), source: "internal_dependency_graph" as const },
    };
    const { product, excluded } = filterProductFindings([fallbackFinding(), nativeDuplicate()], reports);
    assert.equal(product.length, 1);
    assert.equal(product[0]?.type, "duplicate_code");
    assert.equal(excluded.length, 1);
  });

  test("knip unavailable blocks unused import eligibility", () => {
    const reports = { knip: baseReport("fallback", "fallback") };
    assert.equal(isKnipAvailable(reports), false);
  });

  test("no-op preflight is not eligible", () => {
    const finding: Finding = {
      ...fallbackFinding(),
      type: "unused_import",
      source: "repodiet_import",
      sourceMode: "native",
      evidence: {
        summary: "x",
        signals: ["symbol=Foo", "importLine=import { Foo } from 'x';", "classification=detected_candidate"],
      },
    };
    assert.equal(isTransformedFinding(finding), false);
    assert.equal(isEligibleFinding(finding), false);
  });

  test("actionable preflight is eligible", () => {
    const finding: Finding = {
      ...fallbackFinding(),
      type: "unused_import",
      source: "repodiet_import",
      sourceMode: "native",
      evidence: {
        summary: "x",
        signals: [
          "symbol=Foo",
          "importLine=import { Foo } from 'x';",
          "classification=actionable_candidate",
        ],
      },
    };
    assert.equal(isTransformedFinding(finding), true);
  });

  test("cleanup PR disabled when generatedChanges is zero", () => {
    const gates = computeWorkflowGates({
      scanComplete: true,
      findings: {
        scanId: "s",
        repo: { owner: "o", name: "n", branch: "main" },
        summary: {
          totalFindings: 1,
          duplicateClusters: 1,
          unusedFiles: 0,
          unusedDependencies: 0,
          unusedExports: 0,
          orphanPatterns: 0,
          slopSignals: 0,
          reviewRequired: 1,
          safeCandidates: 0,
          doNotTouch: 0,
        },
        duplicates: [],
        unused: { files: [], dependencies: [], exports: [] },
        orphans: [],
        slopSignals: [],
        riskBuckets: { safeDelete: [], reviewFirst: [], doNotTouch: [] },
        artifacts: { findingsJson: true },
        mode: "live",
        rawToolReports: {
          knip: baseReport("fallback", "fallback"),
          jscpd: { ...baseReport("ok", "native"), source: "jscpd" },
          madge: baseReport("fallback", "fallback"),
        },
      },
      patchKit: {
        id: "p1",
        repo: { owner: "o", name: "n", branch: "main" },
        summary: {
          safeDeleteCandidates: 0,
          transformerCompatible: 0,
          dryRunPassed: 0,
          generatedChanges: 0,
          validatedChanges: 0,
          verifiedChanges: 0,
          filesEdited: 0,
          filesDeleted: 0,
          filesAdded: 0,
          rawReviewFindings: 0,
          reviewFirstItems: 0,
          doNotTouchItems: 0,
          packageSuggestions: 0,
          patchLines: 0,
          regressionChecks: 0,
          bundleFileCount: 0,
          patchValidationStatus: "not_generated",
        },
        patchValidation: { status: "not_generated" },
        artifacts: {} as PatchKitPayload["artifacts"],
      } as PatchKitPayload,
    });
    assert.equal(gates.cleanupPrAvailable, false);
    assert.equal(gates.quickCleanupState, "failed");
    assert.equal(gates.reportOnlyPrAvailable, true);
  });

  test("summarizeCleanupAttempts never treats noop as generated", () => {
    const stats = summarizeCleanupAttempts([
      {
        findingId: "a",
        findingType: "unused_import",
        pluginId: "remove_unused_import",
        strategyIds: [],
        sourceFound: true,
        sourceHashMatched: true,
        transformAttempted: true,
        contentChanged: false,
        dryRunSucceeded: false,
        proposedSourceChanged: false,
        proposedDiffGenerated: false,
        patchValidated: false,
        verificationSupported: true,
        retained: false,
        blockerCode: "transform_noop",
      },
    ]);
    assert.equal(stats.noop, 1);
    assert.equal(stats.generatedChanges, 0);
  });
}

run();
console.log("strict-mode.test.ts: ok");
