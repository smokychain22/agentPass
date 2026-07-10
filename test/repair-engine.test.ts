import assert from "node:assert/strict";
import {
  QUICK_CLEANUP_ATTEMPT_LIMIT,
  QUICK_CLEANUP_RETAINED_FIX_LIMIT,
} from "../src/lib/execution/constants";
import {
  auditFromPreflight,
  formatBlockerBreakdown,
  summarizeBlockers,
  type CandidateAuditRecord,
} from "../src/lib/execution/candidate-lifecycle";
import type { FixPreflightResult } from "../src/lib/execution/fix-preflight";
import {
  isActionableFinding,
  isDryRunPassed,
  isTransformerCompatible,
} from "../src/lib/findings/actionability-signals";
import { attemptConsumesCandidateLimit } from "../src/lib/execution/outcomes";
import type { Finding } from "../src/lib/findings/types";
import { computeWorkflowGates } from "../src/lib/workflow/gates";

function patchHasApplyableOperations(patch: string): boolean {
  return /^diff --git /m.test(patch);
}

function sampleFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    type: "unused_import",
    title: "Unused import: Clock",
    files: ["src/Dashboard.tsx"],
    confidence: 0.9,
    confidenceReason: "test",
    severity: "low",
    action: "safe_candidate",
    reason: "test",
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

function noopPreflight(): FixPreflightResult {
  return {
    pluginAvailable: true,
    strategyAvailable: true,
    sourceLocated: true,
    sourceHashMatches: true,
    dryRunChangedSource: false,
    diffGenerated: false,
    protectedPathCheck: true,
    requiredVerificationSupported: true,
    classification: "detected_candidate",
    pluginId: "remove_unused_import",
    blocker: "Dry-run could not produce a valid source modification.",
    blockerCode: "transform_noop",
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

console.log("Repair engine tests");

test("transformer compatible without dry-run is not actionable", () => {
  const finding = sampleFinding();
  assert.equal(isTransformerCompatible(finding), true);
  assert.equal(isDryRunPassed(finding), false);
  assert.equal(isActionableFinding(finding), false);
});

test("dry-run passed finding is actionable", () => {
  const finding = sampleFinding({
    evidence: {
      summary: "x",
      signals: [
        "symbol=Clock",
        'importLine=import { Clock, Play } from "lucide-react";',
        "classification=actionable_candidate",
      ],
    },
  });
  assert.equal(isDryRunPassed(finding), true);
  assert.equal(isActionableFinding(finding), true);
});

test("transform noop does not consume attempt limit", () => {
  assert.equal(attemptConsumesCandidateLimit("transform_noop"), false);
  assert.equal(attemptConsumesCandidateLimit("infrastructure_failed"), false);
  assert.equal(attemptConsumesCandidateLimit("rolled_back_regression"), true);
});

test("audit records blocker for dry-run noop", () => {
  const audit = auditFromPreflight(sampleFinding(), noopPreflight());
  assert.equal(audit.dryRunSucceeded, false);
  assert.equal(audit.blockerCode, "transform_noop");
});

test("blocker breakdown is explicit not generic skipped", () => {
  const audits: CandidateAuditRecord[] = [
    {
      findingId: "a",
      findingType: "unused_import",
      pluginId: "remove_unused_import",
      strategyIds: [],
      sourceFound: true,
      sourceHashMatched: true,
      dryRunSucceeded: false,
      proposedSourceChanged: false,
      proposedDiffGenerated: false,
      patchValidated: false,
      verificationSupported: true,
      retained: false,
      blockerCode: "transform_noop",
    },
    {
      findingId: "b",
      findingType: "unused_import",
      pluginId: "remove_unused_import",
      strategyIds: [],
      sourceFound: true,
      sourceHashMatched: true,
      dryRunSucceeded: true,
      proposedSourceChanged: true,
      proposedDiffGenerated: true,
      patchValidated: false,
      verificationSupported: true,
      retained: false,
      blockerCode: "not_attempted",
    },
  ];
  const summary = formatBlockerBreakdown(audits);
  assert.match(summary, /transformer-compatible/i);
  assert.match(summary, /0 verified changes retained/i);
  assert.match(summary, /transform noop/i);
  const counts = summarizeBlockers(audits);
  assert.equal(counts.transform_noop, 1);
  assert.equal(counts.not_attempted, 1);
});

test("quick cleanup limits: 5 retained, 15 attempts", () => {
  assert.equal(QUICK_CLEANUP_RETAINED_FIX_LIMIT, 5);
  assert.equal(QUICK_CLEANUP_ATTEMPT_LIMIT, 15);
});

test("zero verified changes cannot unlock cleanup PR", () => {
  const gates = computeWorkflowGates({
    scanComplete: true,
    findings: {
      scanId: "s",
      mode: "live",
      repo: { owner: "o", name: "r", branch: "main" },
      summary: {
        totalFindings: 1,
        duplicateClusters: 0,
        unusedFiles: 0,
        unusedDependencies: 0,
        unusedExports: 0,
        orphanPatterns: 0,
        slopSignals: 0,
        reviewRequired: 0,
        safeCandidates: 1,
        doNotTouch: 0,
        transformerCompatible: 1,
      },
      duplicates: [],
      unused: { files: [], dependencies: [], exports: [] },
      orphans: [],
      slopSignals: [],
      riskBuckets: { safeDelete: [], reviewFirst: [], doNotTouch: [] },
      artifacts: { findingsJson: true },
      rawToolReports: {
        knip: { status: "ok", source: "knip", sourceMode: "native", durationMs: 1 },
        jscpd: { status: "ok", source: "jscpd", sourceMode: "native", durationMs: 1 },
        madge: { status: "ok", source: "madge", sourceMode: "native", durationMs: 1 },
      },
    },
    patchKit: {
      id: "p",
      repo: { owner: "o", name: "r", branch: "main" },
      summary: {
        safeDeleteCandidates: 0,
        transformerCompatible: 3,
        dryRunPassed: 2,
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
        bundleFileCount: 5,
        patchValidationStatus: "not_generated",
      },
      patchValidation: { status: "not_generated", error: "No patch" },
      artifacts: {
        reportMd: "# r",
        cleanupPatch: "",
        packageCleanupMd: "",
        regressionChecklistMd: "",
        cursorPromptMd: "",
        findingsJson: {} as never,
        patchkitSummaryJson: "{}",
      },
      downloadUrl: "/x",
    },
  });
  assert.equal(gates.cleanupPrAvailable, false);
  assert.equal(gates.quickCleanupState, "blocked");
});

test("report-only patch with no ops is not applyable", () => {
  const reportOnly = "# RepoDiet report\n\nNo code changes.\n";
  assert.equal(patchHasApplyableOperations(reportOnly), false);
});

console.log("repair-engine.test.ts: ok");
