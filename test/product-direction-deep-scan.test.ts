import assert from "node:assert/strict";
import { stagePercent } from "../src/lib/deep-scan/types";
import { createDeepScanJob, getDeepScanJob, claimNextDeepScanJob } from "../src/lib/deep-scan/job-store";
import { toEvidenceStandardFinding } from "../src/lib/findings/evidence-standard";
import type { Finding } from "../src/lib/findings/types";
import { TRANSFORM_CONTRACTS } from "../src/lib/execution/transform-contracts";
import {
  E2E_REGRESSION_FIXTURE,
  isRegressionFixtureOnly,
  MERIDIAN_PROOF,
} from "../src/lib/product/proof-repositories";

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      console.error(`  ✗ ${name}`);
      throw err;
    }
  })();
}

console.log("product-direction-deep-scan");

async function main() {
  await test("deep scan stage percent reaches READY at 100", () => {
    assert.equal(stagePercent("QUEUED"), 0);
    assert.equal(stagePercent("READY"), 100);
  });

  await test("durable deep scan job persists and claims", async () => {
    const job = await createDeepScanJob({
      repoUrl: MERIDIAN_PROOF.url,
      branch: "main",
      readOnly: true,
      requestedBy: "test",
    }, { idempotencyKey: `test-claim-${Date.now()}` });
    const loaded = await getDeepScanJob(job.id);
    assert.ok(loaded);
    assert.ok(["QUEUED", "INVENTORY", "READY"].includes(loaded!.stage));
    // Claim loop may pick an older queued job first; assert our job remains retrievable.
    const claimed = await claimNextDeepScanJob("test-worker");
    assert.ok(claimed);
    assert.ok(claimed!.claimedBy === "test-worker");
    const stillThere = await getDeepScanJob(job.id);
    assert.ok(stillThere);
  });

  await test("evidence standard separates why removable vs unsafe", () => {
    const finding = {
      id: "orphan_file_17",
      type: "unused_file",
      title: "Orphan",
      files: ["src/archive/OldDashboard.tsx"],
      confidence: 0.9,
      confidenceReason: "graph",
      severity: "medium",
      action: "safe_candidate",
      reason: "no references",
      source: "heuristic",
      sourceMode: "heuristic",
      evidence: {
        summary: "No static or dynamic references found.",
        signals: ["staticReferences=0", "dynamicReferences=0"],
      },
      deletionProof: {
        findingId: "orphan_file_17",
        filePath: "src/archive/OldDashboard.tsx",
        whyBelievedUnnecessary: "Zero inbound references across import graph.",
        analyzersAgreeing: ["import_graph"],
        entryPointsChecked: [],
        importsChecked: true,
        dynamicReferencesChecked: true,
        configsChecked: true,
        scriptsChecked: true,
        packageExportsChecked: true,
        frameworkConventionsChecked: true,
        protected: false,
        verificationRequired: ["typecheck", "build"],
        evidenceGrade: "strong",
        approvedForAutomaticDeletion: true,
      },
      evidenceBundle: {
        analyzerEvidence: [],
        graphEvidence: [],
        frameworkEvidence: [],
        configurationEvidence: [],
        scriptEvidence: [],
        runtimeEvidence: [],
        gitEvidence: [],
        counterEvidence: [{ channel: "x", source: "y", summary: "May be lazy-loaded", strength: "contradicting" }],
        unresolvedRisks: [],
        grade: "moderate",
        classificationState: "supported",
        classificationLabel: "confirmed_unused",
        decisionReason: "ok",
        autoFixAllowed: true,
      },
    } as Finding;

    const std = toEvidenceStandardFinding(finding, "abc", ".");
    assert.equal(std.classification, "SAFE_CANDIDATE");
    assert.match(std.evidence.whyBelievedRemovable, /Zero inbound/);
    assert.ok(std.evidence.whatCouldMakeRemovalUnsafe.some((s) => /lazy-loaded/i.test(s)));
  });

  await test("transform contracts require supports/plan/apply/validate/rollback", () => {
    for (const t of TRANSFORM_CONTRACTS) {
      assert.deepEqual(t.requiredMethods, ["supports", "plan", "apply", "validate", "rollback"]);
    }
  });

  await test("e2e fixture is regression-only, Meridian is primary proof", () => {
    assert.equal(isRegressionFixtureOnly("velz-cmd", "repodiet-e2e-test"), true);
    assert.equal(E2E_REGRESSION_FIXTURE.role, "regression_fixture_only");
    assert.equal(MERIDIAN_PROOF.role, "primary_complex_proof");
  });

  console.log("product-direction-deep-scan: all passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
