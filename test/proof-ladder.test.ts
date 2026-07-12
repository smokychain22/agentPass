import assert from "node:assert/strict";
import {
  buildCleanupProof,
  buildCleanupProofFromRun,
  buildPatchKitSummaryFromCleanupResult,
  buildProofLadderCounts,
  formatProofLadderSummary,
} from "../src/lib/execution/proof-ladder";
import type { FreeCleanupResult } from "../src/lib/execution/run-cleanup-core";
import type { FindingsPayload } from "../src/lib/findings/types";

function sampleFindings(): FindingsPayload {
  return {
    scanId: "scan_test",
    repo: { owner: "demo", name: "repo", branch: "main", commitSha: "abc123" },
    summary: {
      totalFindings: 12,
      detectedFindings: 12,
      verifiedFindings: 10,
      duplicateClusters: 1,
      unusedFiles: 2,
      unusedDependencies: 1,
      unusedExports: 0,
      orphanPatterns: 0,
      slopSignals: 0,
      reviewRequired: 4,
      safeCandidates: 6,
      doNotTouch: 2,
    },
    duplicates: [],
    unused: { files: [], dependencies: [], exports: [] },
    orphans: [],
    slopSignals: [],
    riskBuckets: { safeDelete: [], reviewFirst: [], doNotTouch: [] },
    artifacts: { findingsJson: false },
    mode: "live",
    rawToolReports: {
      knip: { status: "ok", source: null, sourceMode: "native", durationMs: 1 },
      jscpd: { status: "ok", source: null, sourceMode: "native", durationMs: 1 },
      madge: { status: "ok", source: null, sourceMode: "native", durationMs: 1 },
    },
  };
}

function sampleCleanup(): FreeCleanupResult {
  return {
    id: "cleanup_test",
    mode: "auto_fix",
    selectedFindings: [],
    skippedCount: 0,
    fileChanges: [{ path: "src/Dashboard.tsx", findingIds: ["f1"] }],
    unifiedDiff: "diff",
    patchStatus: "validated",
    patchValidation: { status: "passed" },
    verification: { status: "passed", checks: [], limitations: [] },
    fixLoop: {
      selected: 6,
      verified: 2,
      skipped: 2,
      rejected: 1,
      rolledBack: 0,
      unsupported: 0,
      reviewReady: 0,
      evaluated: 5,
      notAttempted: 1,
      attempts: [],
      candidateDecisions: [],
    },
    stateTransitions: [],
    proof: {
      changedFiles: ["src/Dashboard.tsx"],
      linesAdded: 1,
      linesRemoved: 3,
      executedCommands: [],
      finalDecision: "verified_fix",
      productOutcome: "verified_fix",
      commitSha: "abc123",
      githubModified: false,
    },
    metrics: {
      issuesSelected: 6,
      issuesChanged: 2,
      filesChanged: 1,
      linesAdded: 1,
      linesRemoved: 3,
    },
    artifacts: {
      reportMd: "",
      cleanupPromptMd: "",
      regressionChecklistMd: "",
      selectedFindingsJson: "[]",
    },
    limitations: [],
    verifiedLabel: "verified",
    candidateAudits: [
      {
        findingId: "f1",
        findingType: "unused_import",
        pluginId: "remove_unused_import",
        strategyIds: ["remove_unused_import"],
        sourceFound: true,
        sourceHashMatched: true,
        scanEligible: true,
        transformAttempted: true,
        contentChanged: true,
        dryRunSucceeded: true,
        proposedSourceChanged: true,
        proposedDiffGenerated: true,
        patchValidated: true,
        verificationSupported: true,
        retained: true,
      },
      {
        findingId: "f2",
        findingType: "unused_import",
        pluginId: "remove_unused_import",
        strategyIds: ["remove_unused_import"],
        sourceFound: true,
        sourceHashMatched: true,
        scanEligible: true,
        transformAttempted: true,
        contentChanged: false,
        dryRunSucceeded: false,
        proposedSourceChanged: false,
        proposedDiffGenerated: false,
        patchValidated: false,
        verificationSupported: false,
        retained: false,
        blockerCode: "transform_noop",
      },
      {
        findingId: "f3",
        findingType: "duplicate_code",
        pluginId: "review_only",
        strategyIds: [],
        sourceFound: true,
        sourceHashMatched: true,
        scanEligible: false,
        transformAttempted: false,
        contentChanged: false,
        dryRunSucceeded: false,
        proposedSourceChanged: false,
        proposedDiffGenerated: false,
        patchValidated: false,
        verificationSupported: false,
        retained: false,
        blockerCode: "not_attempted",
      },
    ],
    receipt: {
      taskId: "cleanup_test",
      repository: "demo/repo",
      commitSha: "abc123",
      findingIds: ["f1"],
      patchHash: "sha256:test",
      verificationHash: "sha256:test",
      status: "verified",
      timestamp: new Date().toISOString(),
    },
  };
}

function testProofLadderCounts(): void {
  const findings = sampleFindings();
  const ladder = buildProofLadderCounts({
    findings,
    summary: {
      safeDeleteCandidates: 2,
      transformerCompatible: 2,
      dryRunPassed: 1,
      eligibleFindings: 2,
      attemptedTransformations: 2,
      generatedChanges: 1,
      validatedChanges: 1,
      verifiedChanges: 1,
      filesEdited: 1,
      filesDeleted: 0,
      filesAdded: 0,
      rawReviewFindings: 4,
      reviewFirstItems: 4,
      doNotTouchItems: 2,
      packageSuggestions: 1,
      patchLines: 4,
      regressionChecks: 3,
      bundleFileCount: 7,
      noopTransformations: 1,
      failedTransformations: 0,
      notAttempted: 1,
      patchValidationStatus: "passed",
    },
    verificationStatus: "passed",
  });

  assert.equal(ladder.detected, 12);
  assert.equal(ladder.eligible, 2);
  assert.equal(ladder.generated, 1);
  assert.equal(ladder.contentValidated, 1);
  assert.equal(ladder.gitValidated, 1);
  assert.equal(ladder.validated, 1);
  assert.equal(ladder.delivered, 1);
  assert.equal(ladder.rejectedForSafety, 10);
}

function testCleanupProofFromRun(): void {
  const findings = sampleFindings();
  const cleanup = sampleCleanup();
  const proof = buildCleanupProofFromRun({ findings, cleanup });

  assert.equal(proof.scanId, "scan_test");
  assert.equal(proof.commitSha, "abc123");
  assert.equal(proof.generatedChanges, 1);
  assert.equal(proof.validatedChanges, 1);
  assert.equal(proof.proof.linesRemoved, 3);
  assert.ok(proof.ladder.eligible >= 1);
}

function testCleanupProofWithPrUrl(): void {
  const findings = sampleFindings();
  const proof = buildCleanupProof({
    findings,
    summary: buildPatchKitSummaryFromCleanupResult(sampleCleanup(), findings),
    verificationStatus: "passed",
    pullRequestUrl: "https://github.com/demo/repo/pull/42",
  });

  assert.equal(proof.pullRequestUrl, "https://github.com/demo/repo/pull/42");
  assert.equal(proof.ladder.delivered, proof.ladder.validated);
}

function testFormatSummary(): void {
  const text = formatProofLadderSummary({
    detected: 12,
    eligible: 2,
    attempted: 2,
    generated: 1,
    validated: 1,
    contentValidated: 1,
    gitValidated: 1,
    verified: 1,
    delivered: 1,
    noop: 1,
    failed: 0,
    notAttempted: 1,
    rejectedForSafety: 10,
  });

  assert.match(text, /12 detected findings/);
  assert.match(text, /1 validated file operations/);
  assert.match(text, /10 review-first or protected/);
}

testProofLadderCounts();
testCleanupProofFromRun();
testCleanupProofWithPrUrl();
testFormatSummary();
console.log("proof-ladder.test.ts: ok");
