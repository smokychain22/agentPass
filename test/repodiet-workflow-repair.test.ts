/**
 * COMMAND 3A — production RepoDiet user-workflow repair.
 * Proves: (1) results are never exposed before a scan has genuinely
 * completed and findings have been persisted, (2) finding decisions are
 * idempotently persisted (survive "refresh" — a fresh read from durable
 * storage), (3) finding actions are specific to the finding type and never
 * a generic yes/no/not-sure triad, and (4) no action claims to "verify"
 * something RepoDiet cannot actually verify yet.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "repodiet-workflow-repair-"));
process.env.REPODIET_DATA_DIR = dataDir;

import type { Finding } from "../src/lib/findings/types";
import { canOpenResults } from "../src/lib/workflow/results-readiness";
import {
  saveFindingDecision,
  listFindingDecisions,
  computeDecisionsFingerprint,
} from "../src/lib/user-directed/decision-store";
import {
  saveDraftPlan,
  approvePlan,
  getPlanState,
  isPlanApprovedForCommit,
  isPlanCurrent,
} from "../src/lib/user-directed/cleanup-plan-store";
import { computeCreateCleanupPrReadiness } from "../src/lib/workflow/create-cleanup-pr-readiness";
import { buildFindingCardActions } from "../src/lib/user-directed/finding-card-actions";

function finding(overrides: Partial<Finding>): Finding {
  return {
    id: "fnd_test",
    type: "unused_file",
    title: "Unused file",
    action: "safe_candidate",
    confidence: 0.8,
    confidenceReason: "test fixture",
    severity: "medium",
    reason: "test fixture",
    files: ["src/example.ts"],
    source: "knip",
    sourceMode: "native",
    evidence: { summary: "test evidence", signals: ["signal=1"] },
    ...overrides,
  };
}

// --- canOpenResults: results must never be exposed early -------------------

async function testCanOpenResults() {
  const base = {
    scan: { phase: "complete" as const, repo: { commitSha: "abc123" } },
    findings: { some: "payload" },
    findingsAnalysisPhase: "ready" as const,
    findingsAnalysisError: null,
    activeRepository: { commitSha: "abc123" },
  };

  assert.equal(canOpenResults(base), true, "fully ready state must allow Open Results");

  for (const scanPhase of ["validating", "persisting", "pending", "inventorying"] as const) {
    assert.equal(
      canOpenResults({ ...base, scan: { phase: scanPhase, repo: base.scan.repo } }),
      false,
      `scan phase "${scanPhase}" must not allow Open Results`
    );
  }

  for (const findingsPhase of [
    "queued",
    "running_jscpd",
    "normalizing",
    "persisting",
    "baseline",
  ] as const) {
    assert.equal(
      canOpenResults({ ...base, findingsAnalysisPhase: findingsPhase }),
      false,
      `findings phase "${findingsPhase}" must not allow Open Results`
    );
  }

  assert.equal(
    canOpenResults({ ...base, findings: null }),
    false,
    "no findings payload must not allow Open Results"
  );
  assert.equal(
    canOpenResults({ ...base, findingsAnalysisError: new Error("boom") }),
    false,
    "an analysis error must not allow Open Results, even if phase looks complete"
  );
  assert.equal(
    canOpenResults({ ...base, activeRepository: { commitSha: "different-commit" } }),
    false,
    "a stale analyzed commit vs. the active repository must not allow Open Results"
  );
  assert.equal(canOpenResults({ ...base, scan: null }), false, "no scan must not allow Open Results");
}

// --- Decision persistence — idempotent, survives "refresh" -----------------

async function testDecisionPersistence() {
  const scanId = "scan_decision_test";

  await saveFindingDecision({
    scanId,
    findingId: "fnd_a",
    decision: "selected",
    analyzedCommit: "abc123",
    filesToRemove: ["src/a.ts"],
  });
  // Repeated identical decision must not create a duplicate record.
  await saveFindingDecision({
    scanId,
    findingId: "fnd_a",
    decision: "selected",
    analyzedCommit: "abc123",
    filesToRemove: ["src/a.ts"],
  });
  // Changing the decision on the same finding must overwrite, not append.
  await saveFindingDecision({
    scanId,
    findingId: "fnd_a",
    decision: "excluded",
    analyzedCommit: "abc123",
  });
  await saveFindingDecision({
    scanId,
    findingId: "fnd_b",
    decision: "kept",
    analyzedCommit: "abc123",
    filesToKeep: ["src/b.ts"],
  });

  // Simulate "refresh" — a completely fresh read from durable storage.
  const decisions = await listFindingDecisions(scanId);
  assert.equal(decisions.length, 2, "exactly one persisted record per finding, no duplicates");
  const a = decisions.find((d) => d.findingId === "fnd_a");
  const b = decisions.find((d) => d.findingId === "fnd_b");
  assert.ok(a, "decision for fnd_a must survive refresh");
  assert.equal(a!.decision, "excluded", "the latest decision must be the one that survives");
  assert.ok(b, "decision for fnd_b must survive refresh");
  assert.equal(b!.decision, "kept");
}

// --- Cleanup plan state machine ---------------------------------------------

async function testCleanupPlanApproval() {
  const scanId = "scan_plan_test";
  const commit = "commit_v1";
  const fingerprintV1 = computeDecisionsFingerprint([
    { scanId, findingId: "fnd_a", decision: "selected", decisionTimestamp: "t1" },
  ]);

  const draft = await saveDraftPlan({
    scanId,
    pinnedCommit: commit,
    includedFindingIds: ["fnd_a"],
    excludedFindingIds: [],
    decisionsFingerprint: fingerprintV1,
  });
  assert.equal(draft.status, "draft");
  assert.equal(isPlanApprovedForCommit(draft, commit), false);

  const approved = await approvePlan({
    scanId,
    pinnedCommit: commit,
    includedFindingIds: ["fnd_a"],
    decisionsFingerprint: fingerprintV1,
  });
  assert.equal(approved.status, "approved");
  assert.equal(isPlanApprovedForCommit(approved, commit), true);
  assert.equal(isPlanCurrent(approved, commit, fingerprintV1), true);

  // Approving again with the same selection is idempotent — no state churn.
  const approvedAgain = await approvePlan({
    scanId,
    pinnedCommit: commit,
    includedFindingIds: ["fnd_a"],
    decisionsFingerprint: fingerprintV1,
  });
  assert.equal(approvedAgain.status, "approved");
  assert.equal(approvedAgain.updatedAt, approved.updatedAt, "re-approving the same plan must not bump state");

  // A plan for a different, unprepared commit cannot be approved.
  await assert.rejects(
    approvePlan({
      scanId,
      pinnedCommit: "commit_v2",
      includedFindingIds: ["fnd_a"],
      decisionsFingerprint: fingerprintV1,
    }),
    /prepared for this commit/
  );

  // A decision changing after approval must be detectable as "not current"
  // (superseded) purely from persisted state — the client must never be
  // able to disagree with this by keeping stale local state.
  const fingerprintV2 = computeDecisionsFingerprint([
    { scanId, findingId: "fnd_a", decision: "kept", decisionTimestamp: "t2" },
  ]);
  assert.equal(
    isPlanCurrent(approved, commit, fingerprintV2),
    false,
    "a changed decision must make the previously-approved plan stale"
  );
  await assert.rejects(
    approvePlan({
      scanId,
      pinnedCommit: commit,
      includedFindingIds: ["fnd_a"],
      decisionsFingerprint: fingerprintV2,
    }),
    /decision changed/
  );

  const stored = await getPlanState(scanId);
  assert.equal(stored?.status, "approved");
}

// --- Finding card actions — type-specific, never a generic triad -----------

function testDuplicateActions() {
  const f = finding({
    type: "duplicate_code",
    files: ["src/components/StatusCard.tsx", "src/components/StatusCardCopy.tsx"],
  });
  const actions = buildFindingCardActions(f, "Safe to fix");
  const labels = actions.map((a) => a.label);

  assert.ok(labels.some((l) => l.includes("Use") && l.includes("remove the copy")));
  assert.ok(labels.includes("Choose the other file"));
  assert.ok(labels.includes("Keep both files"));
  assert.ok(labels.includes("Exclude from this cleanup"));

  const primary = actions.find((a) => a.kind === "primary")!;
  assert.equal(primary.canonicalFile, "src/components/StatusCard.tsx");
  assert.deepEqual(primary.filesToRemove, ["src/components/StatusCardCopy.tsx"]);

  const keepBoth = actions.find((a) => a.label === "Keep both files")!;
  assert.equal(keepBoth.decision, "kept");
  assert.deepEqual(keepBoth.filesToKeep, f.files);
}

function testDependencyActions() {
  const f = finding({ type: "unused_dependency", packageName: "left-pad", files: ["package.json"] });
  const actions = buildFindingCardActions(f, "Safe to fix");
  const labels = actions.map((a) => a.label);
  assert.deepEqual(labels, ["Remove dependency", "Keep dependency", "Exclude from cleanup"]);
  const remove = actions.find((a) => a.label === "Remove dependency")!;
  assert.equal(remove.decision, "selected");
  assert.deepEqual(remove.filesToRemove, ["package.json"]);
}

function testArchiveActions() {
  const f = finding({
    type: "ai_slop_signal",
    files: ["src/archive/OldDashboard.backup.tsx", "src/unused/confirmed-unused.ts"],
  });
  const actions = buildFindingCardActions(f, "Safe to fix");
  assert.ok(actions.some((a) => a.label === "Remove backup files" && a.kind === "primary"));
  assert.ok(actions.some((a) => a.label === "Keep these files"));
  assert.ok(actions.some((a) => a.label === "Exclude from cleanup"));
}

function testUncertainFindingActions() {
  const f = finding({ files: ["src/plugins/dynamic-loader.ts"] });
  const actions = buildFindingCardActions(f, "Needs your review");
  const labels = actions.map((a) => a.label);

  // Never a generic yes/no/not-sure triad, and never a preselected deletion.
  assert.ok(!labels.some((l) => /not sure/i.test(l)));
  assert.ok(!labels.some((l) => /^yes, keep it$/i.test(l)));
  const primary = actions.find((a) => a.kind === "primary")!;
  assert.equal(primary.decision, "kept", "uncertain findings must default to keep, never deletion");
  assert.ok(primary.label.includes("recommended"));
  assert.ok(labels.some((l) => l.startsWith("Remove") && l.includes("dynamic-loader.ts")));
}

function testNoFakeVerifyActions() {
  // "Verify usage first" / "Verify runtime usage" must never be rendered
  // unless they trigger a real backend verification — RepoDiet does not
  // implement that yet, so no action anywhere may claim to "verify".
  const cases: Array<[Finding["type"], "Safe to fix" | "Needs your review"]> = [
    ["unused_file", "Safe to fix"],
    ["unused_dependency", "Safe to fix"],
    ["ai_slop_signal", "Safe to fix"],
    ["duplicate_code", "Safe to fix"],
    ["unused_file", "Needs your review"],
  ];
  for (const [type, status] of cases) {
    const actions = buildFindingCardActions(finding({ type }), status);
    for (const action of actions) {
      assert.ok(
        !/verify/i.test(action.label),
        `no-op-risk: "${action.label}" (type=${type}, status=${status}) claims verification RepoDiet does not perform`
      );
    }
  }
}

function testEveryActionHasARealConsequenceAndDecision() {
  const types: Finding["type"][] = [
    "unused_file",
    "unused_dependency",
    "duplicate_code",
    "ai_slop_signal",
    "unused_export",
    "unused_import",
    "orphan_pattern",
  ];
  for (const type of types) {
    const files = type === "duplicate_code" ? ["a.ts", "b.ts"] : ["a.ts"];
    const actions = buildFindingCardActions(finding({ type, files }), "Safe to fix");
    assert.ok(actions.length >= 2, `${type} must expose at least a primary and one alternative action`);
    for (const action of actions) {
      assert.ok(action.consequence.length > 0, `every action must state a real consequence (${action.id})`);
      assert.ok(action.decision, `every action must map to a real persisted decision (${action.id})`);
    }
  }
}

// --- Authoritative Create-Cleanup-PR readiness selector ---------------------

function baseReadinessInput() {
  return {
    scanComplete: true,
    findingsReady: true,
    findingsError: false,
    analyzedCommit: "abc123",
    activeCommit: "abc123",
    eligibleSelectedCount: 2,
    unresolvedRequiredCount: 0,
    planApproved: true,
    planCurrent: true,
    planSuperseded: false,
    githubWriteCapable: true,
  };
}

function testCreateCleanupPrReadiness() {
  const fullyReady = computeCreateCleanupPrReadiness(baseReadinessInput());
  assert.equal(fullyReady.unlocked, true, "every condition satisfied must unlock");
  assert.deepEqual(fullyReady.reasons, []);

  assert.equal(
    computeCreateCleanupPrReadiness({ ...baseReadinessInput(), scanComplete: false }).unlocked,
    false,
    "incomplete scan must lock the stage"
  );
  assert.equal(
    computeCreateCleanupPrReadiness({ ...baseReadinessInput(), findingsReady: false }).unlocked,
    false,
    "unpersisted findings must lock the stage"
  );
  assert.equal(
    computeCreateCleanupPrReadiness({ ...baseReadinessInput(), analyzedCommit: "old", activeCommit: "new" })
      .unlocked,
    false,
    "a stale analyzed commit must lock the stage"
  );
  assert.equal(
    computeCreateCleanupPrReadiness({ ...baseReadinessInput(), eligibleSelectedCount: 0 }).unlocked,
    false,
    "no selected findings must lock the stage"
  );
  assert.equal(
    computeCreateCleanupPrReadiness({ ...baseReadinessInput(), unresolvedRequiredCount: 1 }).unlocked,
    false,
    "an unresolved required decision must lock the stage"
  );
  assert.equal(
    computeCreateCleanupPrReadiness({ ...baseReadinessInput(), planApproved: false }).unlocked,
    false,
    "an unapproved plan must lock the stage"
  );
  // The core "do not rely on a stale boolean" requirement: even with
  // planApproved true, a superseded/non-current plan must still lock.
  assert.equal(
    computeCreateCleanupPrReadiness({ ...baseReadinessInput(), planSuperseded: true }).unlocked,
    false,
    "a superseded plan must lock the stage even if 'approved' is still true"
  );
  assert.equal(
    computeCreateCleanupPrReadiness({ ...baseReadinessInput(), planCurrent: false }).unlocked,
    false,
    "a non-current plan must lock the stage even if 'approved' is still true"
  );
  assert.equal(
    computeCreateCleanupPrReadiness({ ...baseReadinessInput(), githubWriteCapable: false }).unlocked,
    false,
    "missing GitHub write capability must lock the stage"
  );
}

async function main() {
  await testCanOpenResults();
  await testDecisionPersistence();
  await testCleanupPlanApproval();
  testDuplicateActions();
  testDependencyActions();
  testArchiveActions();
  testUncertainFindingActions();
  testNoFakeVerifyActions();
  testEveryActionHasARealConsequenceAndDecision();
  testCreateCleanupPrReadiness();
  console.log("repodiet-workflow-repair.test.ts passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
