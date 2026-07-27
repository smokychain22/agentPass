/**
 * COMMAND 3D — Real API coverage for the corrected plan-approval blocker
 * (Part 1), protected-finding rejection at approval time (Part 2/4), and
 * the exact-1-selected-fix-with-many-untouched-optional-findings scenario
 * from Part 13/14. Real API route calls, real durable store, isolated
 * temp dir.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "repodiet-plan-approval-"));
process.env.REPODIET_DATA_DIR = dataDir;

import type { Finding, FindingsPayload } from "../src/lib/findings/types";
import { storeFindings } from "../src/lib/findings/findings-store";
import { POST as decisionsPost } from "../src/app/api/user-directed/decisions/route";
import { POST as approvePost } from "../src/app/api/user-directed/approve-cleanup-plan/route";
import { POST as preparePost } from "../src/app/api/user-directed/prepare-cleanup-plan/route";
import { computeCreateCleanupPrReadiness } from "../src/lib/workflow/create-cleanup-pr-readiness";

async function prepare(scanId: string, pinnedCommit: string, includeFindingIds: string[]) {
  const res = await preparePost(
    new Request("http://localhost/api/user-directed/prepare-cleanup-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scanId, pinnedCommit, includeFindingIds }),
    })
  );
  const json = (await res.json()) as { ok?: boolean; error?: string };
  assert.equal(res.status, 200, json.error);
  return json;
}

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`  ✓ ${name}`))
    .catch((err) => {
      console.error(`  ✗ ${name}`);
      throw err;
    });
}

function makeFinding(overrides: Partial<Finding>): Finding {
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
    evidence: { summary: "test evidence", signals: [] },
    ...overrides,
  };
}

function makePayload(scanId: string, commitSha: string, findings: Finding[]): FindingsPayload {
  return {
    scanId,
    repo: { owner: "acme", name: "repo", branch: "main", commitSha },
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

async function run() {
  console.log("command3d-plan-approval");

  const scanId = "scan_3d_approval";
  const commitSha = "commit_3d_v1";

  const selected = makeFinding({ id: "fnd_selected", files: ["src/selected.ts"] });
  const optionalUntouched = Array.from({ length: 34 }, (_, i) =>
    makeFinding({
      id: `fnd_optional_${i}`,
      files: [`src/optional-${i}.ts`],
      action: "review_first",
    })
  );
  const protectedFinding = makeFinding({
    id: "fnd_protected",
    files: ["src/generated/api-client.generated.ts"],
    action: "do_not_touch",
    protected: true,
  });

  await storeFindings(
    makePayload(scanId, commitSha, [selected, ...optionalUntouched, protectedFinding])
  );

  await decisionsPost(
    new Request("http://localhost/api/user-directed/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scanId,
        findingId: "fnd_selected",
        decision: "selected",
        filesToRemove: ["src/selected.ts"],
      }),
    })
  );

  await test(
    "34 untouched optional findings never block approval — a single selected fix is enough",
    async () => {
      await prepare(scanId, commitSha, ["fnd_selected"]);
      const req = new Request("http://localhost/api/user-directed/approve-cleanup-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scanId,
          pinnedCommit: commitSha,
          includeFindingIds: ["fnd_selected"],
        }),
      });
      const res = await approvePost(req);
      const json = (await res.json()) as { ok?: boolean; error?: string };
      assert.equal(res.status, 200, json.error);
      assert.equal(json.ok, true);
    }
  );

  await test("a protected finding can never be included in an approved plan", async () => {
    await prepare(scanId, commitSha, ["fnd_selected"]);
    const req = new Request("http://localhost/api/user-directed/approve-cleanup-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scanId,
        pinnedCommit: commitSha,
        includeFindingIds: ["fnd_selected", "fnd_protected"],
      }),
    });
    const res = await approvePost(req);
    assert.equal(res.status, 403);
    const json = (await res.json()) as { ok?: boolean };
    assert.equal(json.ok, false);
  });

  await test("approval requires at least one selected cleanup action", async () => {
    const req = new Request("http://localhost/api/user-directed/approve-cleanup-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scanId, pinnedCommit: commitSha, includeFindingIds: [] }),
    });
    const res = await approvePost(req);
    assert.equal(res.status, 400);
  });

  await test(
    "a finding with an incomplete verification_requested decision blocks approval with an exact count, not a blanket 'all findings' message",
    async () => {
      const scanId2 = "scan_3d_incomplete";
      const f1 = makeFinding({ id: "fnd_a", files: ["src/a.ts"] });
      const f2 = makeFinding({ id: "fnd_b", files: ["src/b.ts"] });
      await storeFindings(makePayload(scanId2, commitSha, [f1, f2]));
      await decisionsPost(
        new Request("http://localhost/api/user-directed/decisions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scanId: scanId2,
            findingId: "fnd_a",
            decision: "selected",
            filesToRemove: ["src/a.ts"],
          }),
        })
      );
      await decisionsPost(
        new Request("http://localhost/api/user-directed/decisions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scanId: scanId2,
            findingId: "fnd_b",
            decision: "verification_requested",
          }),
        })
      );
      await prepare(scanId2, commitSha, ["fnd_a"]);
      const req = new Request("http://localhost/api/user-directed/approve-cleanup-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scanId: scanId2,
          pinnedCommit: commitSha,
          includeFindingIds: ["fnd_a"],
        }),
      });
      const res = await approvePost(req);
      const json = (await res.json()) as { ok?: boolean; error?: string };
      assert.equal(res.status, 409);
      assert.match(json.error ?? "", /1 selected fix\(es\) still need a choice/);
    }
  );

  // --- Part 5/10: GitHub connection must never gate tab reachability, only the payment action ---

  await test(
    "readiness selector requires GitHub only to unlock payment, independent of nav-level tab access",
    () => {
      const base = {
        scanComplete: true,
        findingsReady: true,
        findingsError: false,
        eligibleSelectedCount: 1,
        unresolvedRequiredCount: 0,
        planApproved: true,
        planCurrent: true,
        planSuperseded: false,
      };
      const withoutGithub = computeCreateCleanupPrReadiness({ ...base, githubWriteCapable: false });
      assert.equal(withoutGithub.unlocked, false);
      assert.ok(withoutGithub.reasons.some((r) => /connect github/i.test(r)));

      const withGithub = computeCreateCleanupPrReadiness({ ...base, githubWriteCapable: true });
      assert.equal(withGithub.unlocked, true);
    }
  );

  console.log("command3d-plan-approval: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
