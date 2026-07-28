/**
 * Cleanup-plan status binding — the authoritative "is the approved plan
 * still valid" selector used by the nav and the direct patch-route guard.
 *
 * Regression: clicking "Continue to Create Cleanup PR" navigated to
 * /app?tab=patch&scanId=... but the patch page reported "Approve your
 * cleanup plan first" for a plan that was genuinely approved. Three
 * compounding causes, two of which are pinned here:
 *
 *  - page.tsx never read ?scanId from the URL, so before session hydration
 *    restored `findings` the plan-status fetch never ran at all;
 *  - when the client could not yet supply pinnedCommit it sent "", and
 *    isPlanCurrent() compared the plan's real commit against "" and
 *    reported a valid plan as not-current.
 *
 * The route now resolves the pinned commit from the stored scan whenever
 * the caller omits it.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "repodiet-plan-status-"));
process.env.REPODIET_DATA_DIR = dataDir;

import type { Finding, FindingsPayload } from "../src/lib/findings/types";
import { storeFindings } from "../src/lib/findings/findings-store";
import { saveFindingDecision, computeDecisionsFingerprint, listFindingDecisions } from "../src/lib/user-directed/decision-store";
import { saveDraftPlan, approvePlan } from "../src/lib/user-directed/cleanup-plan-store";
import { GET as planStatusGet } from "../src/app/api/user-directed/cleanup-plan-status/route";

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`  ✓ ${name}`))
    .catch((err) => {
      console.error(`  ✗ ${name}`);
      throw err;
    });
}

const COMMIT = "c0838e4cda326098a363b44e0e3ebe98e81e9463";

function makePayload(scanId: string, findings: Finding[]): FindingsPayload {
  return {
    scanId,
    repo: {
      owner: "velz-cmd",
      name: "repodiet-e2e-test",
      branch: "main",
      url: "https://github.com/velz-cmd/repodiet-e2e-test",
      commitSha: COMMIT,
    },
    summary: {
      totalFindings: findings.length,
      duplicateClusters: 0,
      unusedFiles: findings.length,
      unusedDependencies: 0,
      unusedExports: 0,
      orphanPatterns: 0,
      slopSignals: 0,
      reviewRequired: 0,
      safeCandidates: findings.length,
      doNotTouch: 0,
    },
    duplicates: [],
    unused: { files: findings, dependencies: [], exports: [] },
    orphans: [],
    slopSignals: [],
    riskBuckets: { safeDelete: [], reviewFirst: [], doNotTouch: [] },
    artifacts: { findingsJson: true },
    mode: "live",
    rawToolReports: {
      knip: { status: "ok", source: "knip", sourceMode: "native", durationMs: 1 },
      jscpd: { status: "ok", source: "jscpd", sourceMode: "native", durationMs: 1 },
      madge: { status: "ok", source: "madge", sourceMode: "native", durationMs: 1 },
    },
  };
}

function get(query: string) {
  return planStatusGet(
    new Request(`http://localhost/api/user-directed/cleanup-plan-status?${query}`)
  );
}

type Status = {
  ok?: boolean;
  approved?: boolean;
  current?: boolean;
  superseded?: boolean;
  pinnedCommit?: string;
  commitSource?: string;
  planScanId?: string | null;
  selectedCount?: number;
};

async function run() {
  console.log("cleanup-plan-status-binding");

  const scanId = "scan_xeXBJuvAiGsJ";
  const finding: Finding = {
    id: "fnd_one",
    type: "unused_file",
    title: "Unused file",
    action: "safe_candidate",
    confidence: 0.9,
    confidenceReason: "test",
    severity: "low",
    reason: "test",
    files: ["src/unused.ts"],
    source: "knip",
    sourceMode: "native",
    evidence: { summary: "test", signals: ["classification=actionable_candidate"] },
  };
  await storeFindings(makePayload(scanId, [finding]));
  await saveFindingDecision({
    scanId,
    findingId: "fnd_one",
    decision: "selected",
    analyzedCommit: COMMIT,
    filesToRemove: ["src/unused.ts"],
  });
  const fingerprint = computeDecisionsFingerprint(await listFindingDecisions(scanId));
  await saveDraftPlan({
    scanId,
    pinnedCommit: COMMIT,
    includedFindingIds: ["fnd_one"],
    excludedFindingIds: [],
    decisionsFingerprint: fingerprint,
  });
  await approvePlan({
    scanId,
    pinnedCommit: COMMIT,
    includedFindingIds: ["fnd_one"],
    decisionsFingerprint: fingerprint,
  });

  await test("requires a scanId", async () => {
    const res = await get("");
    assert.equal(res.status, 400);
  });

  await test("an approved plan with the explicit commit is current", async () => {
    const json = (await (await get(`scanId=${scanId}&pinnedCommit=${COMMIT}`)).json()) as Status;
    assert.equal(json.approved, true);
    assert.equal(json.current, true);
    assert.equal(json.superseded, false);
    assert.equal(json.commitSource, "request");
  });

  await test(
    "REGRESSION: an approved plan is still current when the client cannot supply pinnedCommit",
    async () => {
      // This is the exact production failure: the patch route loaded before
      // session hydration, so pinnedCommit was absent. Previously this
      // compared against "" and reported current:false -> "Approve your
      // cleanup plan first" for an approved plan.
      const json = (await (await get(`scanId=${scanId}`)).json()) as Status;
      assert.equal(json.approved, true);
      assert.equal(json.current, true, "approved plan must remain current without a client commit");
      assert.equal(json.superseded, false);
      assert.equal(json.commitSource, "stored_scan");
      assert.equal(json.pinnedCommit, COMMIT);
    }
  );

  await test("the response echoes the scan it judged, so callers can prove binding", async () => {
    const json = (await (await get(`scanId=${scanId}`)).json()) as Status;
    assert.equal(json.planScanId, scanId);
    assert.equal(json.selectedCount, 1);
  });

  await test("an empty pinnedCommit parameter behaves like an omitted one", async () => {
    const json = (await (await get(`scanId=${scanId}&pinnedCommit=`)).json()) as Status;
    assert.equal(json.current, true);
    assert.equal(json.commitSource, "stored_scan");
  });

  await test("a different commit still correctly supersedes the plan", async () => {
    const json = (await (await get(`scanId=${scanId}&pinnedCommit=deadbeefdeadbeef`)).json()) as Status;
    assert.equal(json.approved, true);
    assert.equal(json.current, false);
    assert.equal(json.superseded, true);
  });

  await test("changing a decision after approval supersedes the plan", async () => {
    await saveFindingDecision({
      scanId,
      findingId: "fnd_second",
      decision: "selected",
      analyzedCommit: COMMIT,
    });
    const json = (await (await get(`scanId=${scanId}`)).json()) as Status;
    assert.equal(json.approved, true);
    assert.equal(json.current, false, "a changed decision set must supersede the plan");
    assert.equal(json.superseded, true);
  });

  await test("an unknown scan reports no approved plan rather than throwing", async () => {
    const json = (await (await get("scanId=scan_does_not_exist")).json()) as Status;
    assert.equal(json.ok, true);
    assert.equal(json.approved, false);
    assert.equal(json.current, false);
  });

  console.log("cleanup-plan-status-binding: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
