/**
 * COMMAND 3C — Review Findings decision workspace: classification
 * correctness, backend decision validation (Part 11), and batch actions
 * (Part 6). Real API route calls, real durable store, isolated temp dir.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "repodiet-findings-workspace-"));
process.env.REPODIET_DATA_DIR = dataDir;

import { isDoNotTouchPath, classifyAction } from "../src/lib/findings/confidence-path-rules";
import { riskBucketOf } from "../src/lib/findings/cleanup-eligibility";
import { outcomeStatusLabel } from "../src/lib/user-directed/recommended-action";
import type { Finding, FindingsPayload } from "../src/lib/findings/types";
import { storeFindings } from "../src/lib/findings/findings-store";
import { POST as decisionsPost, GET as decisionsGet } from "../src/app/api/user-directed/decisions/route";
import { POST as batchPost } from "../src/app/api/user-directed/decisions/batch/route";

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

function makePayload(scanId: string, findings: Finding[]): FindingsPayload {
  return {
    scanId,
    repo: { owner: "acme", name: "repo", branch: "main", commitSha: "commit_v1" },
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
  console.log("findings-workspace-command3c");

  // --- Part 1: classification correctness -----------------------------

  await test("next-env.d.ts is classified do_not_touch by the real classifier, never a cleanup candidate", () => {
    assert.equal(isDoNotTouchPath("next-env.d.ts"), true);
    // Mirror the real integration point: normalize-findings.ts derives
    // `action` from classifyAction() at construction time — a finding must
    // never be hardcoded "safe_candidate" independent of its own file path.
    const action = classifyAction(["next-env.d.ts"], { type: "unused_file" });
    assert.equal(action, "do_not_touch");
    const f = makeFinding({ files: ["next-env.d.ts"], action });
    assert.equal(riskBucketOf(f), "PROTECTED");
    assert.equal(outcomeStatusLabel(f), "Protected");
  });

  await test("generated files are protected regardless of static-import evidence", () => {
    assert.equal(isDoNotTouchPath("src/generated/api-client.generated.ts"), true);
    const action = classifyAction(["src/generated/api-client.generated.ts"], { type: "unused_file" });
    assert.equal(action, "do_not_touch");
    const f = makeFinding({ files: ["src/generated/api-client.generated.ts"], action });
    assert.equal(outcomeStatusLabel(f), "Protected");
  });

  await test("migration history and CI workflow files are protected", () => {
    assert.equal(isDoNotTouchPath("migrations/0001_init.sql"), true);
    assert.equal(isDoNotTouchPath(".github/workflows/ci.yml"), true);
  });

  await test("a genuine unused file elsewhere is unaffected by the new patterns", () => {
    assert.equal(isDoNotTouchPath("src/lib/orphan-a.ts"), false);
  });

  // --- Part 11: backend must derive allowed files from the stored finding --

  const scanId = "scan_workspace_test";
  const finding1 = makeFinding({ id: "fnd_1", files: ["src/a.ts"] });
  const finding2 = makeFinding({
    id: "fnd_2",
    type: "duplicate_code",
    files: ["src/b.ts", "src/b-copy.ts"],
  });
  const protectedFinding = makeFinding({
    id: "fnd_protected",
    files: ["next-env.d.ts"],
    action: "do_not_touch", protected: true,
  });
  await storeFindings(makePayload(scanId, [finding1, finding2, protectedFinding]));

  await test("rejects a decision for a finding not present in the stored scan", async () => {
    const req = new Request("http://localhost/api/user-directed/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scanId, findingId: "fnd_does_not_exist", decision: "selected" }),
    });
    const res = await decisionsPost(req);
    assert.equal(res.status, 404);
  });

  await test("rejects a decision for a stale/unknown scanId", async () => {
    const req = new Request("http://localhost/api/user-directed/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scanId: "scan_never_existed", findingId: "fnd_1", decision: "selected" }),
    });
    const res = await decisionsPost(req);
    assert.equal(res.status, 404);
  });

  await test("rejects selecting a protected finding for removal", async () => {
    const req = new Request("http://localhost/api/user-directed/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scanId,
        findingId: "fnd_protected",
        decision: "selected",
        filesToRemove: ["next-env.d.ts"],
      }),
    });
    const res = await decisionsPost(req);
    assert.equal(res.status, 403);
  });

  await test("rejects a client-supplied file not present on the stored finding", async () => {
    const req = new Request("http://localhost/api/user-directed/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scanId,
        findingId: "fnd_1",
        decision: "selected",
        filesToRemove: ["src/not-actually-this-finding.ts"],
      }),
    });
    const res = await decisionsPost(req);
    assert.equal(res.status, 400);
  });

  await test("accepts a real decision bound to the stored finding's own files", async () => {
    const req = new Request("http://localhost/api/user-directed/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scanId,
        findingId: "fnd_1",
        decision: "selected",
        filesToRemove: ["src/a.ts"],
      }),
    });
    const res = await decisionsPost(req);
    const json = (await res.json()) as { ok?: boolean };
    assert.equal(res.status, 200);
    assert.equal(json.ok, true);
  });

  await test("accepts a duplicate-group decision with a valid canonicalFile", async () => {
    const req = new Request("http://localhost/api/user-directed/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scanId,
        findingId: "fnd_2",
        decision: "selected",
        canonicalFile: "src/b.ts",
        filesToRemove: ["src/b-copy.ts"],
      }),
    });
    const res = await decisionsPost(req);
    assert.equal(res.status, 200);
  });

  await test("rejects canonicalFile on a non-duplicate finding type", async () => {
    const req = new Request("http://localhost/api/user-directed/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scanId,
        findingId: "fnd_1",
        decision: "selected",
        canonicalFile: "src/a.ts",
      }),
    });
    const res = await decisionsPost(req);
    assert.equal(res.status, 400);
  });

  // --- Part 6: batch actions -------------------------------------------

  const batchScanId = "scan_batch_test";
  // unused_dependency is the simplest genuinely cleanup-eligible shape:
  // isPhase1StructuralCandidate only requires a packageName for this type.
  const genuinelyEligible = {
    type: "unused_dependency" as const,
    evidence: { summary: "test evidence", signals: ["classification=actionable_candidate"] },
  };
  const safe1 = makeFinding({
    id: "fnd_safe_1",
    files: ["package.json"],
    packageName: "left-pad",
    ...genuinelyEligible,
  });
  const safe2 = makeFinding({
    id: "fnd_safe_2",
    files: ["package.json"],
    packageName: "is-odd",
    ...genuinelyEligible,
  });
  const uncertain = makeFinding({ id: "fnd_uncertain", files: ["src/uncertain.ts"], action: "review_first" });
  const protectedBatch = makeFinding({
    id: "fnd_protected_batch",
    files: ["next-env.d.ts"],
    action: "do_not_touch", protected: true,
  });
  await storeFindings(makePayload(batchScanId, [safe1, safe2, uncertain, protectedBatch]));

  await test("select_recommended only selects genuinely recommended findings", async () => {
    const req = new Request("http://localhost/api/user-directed/decisions/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scanId: batchScanId, action: "select_recommended" }),
    });
    const res = await batchPost(req);
    const json = (await res.json()) as { ok?: boolean; outcomes?: Array<{ findingId: string; ok: boolean }> };
    assert.equal(json.ok, true);
    const selectedIds = (json.outcomes ?? []).map((o) => o.findingId).sort();
    assert.deepEqual(selectedIds, ["fnd_safe_1", "fnd_safe_2"]);

    const listReq = new Request(
      `http://localhost/api/user-directed/decisions?scanId=${batchScanId}`
    );
    const listRes = await decisionsGet(listReq);
    const listJson = (await listRes.json()) as { decisions?: Array<{ findingId: string }> };
    const decidedIds = new Set((listJson.decisions ?? []).map((d) => d.findingId));
    assert.ok(decidedIds.has("fnd_safe_1"));
    assert.ok(decidedIds.has("fnd_safe_2"));
    assert.ok(!decidedIds.has("fnd_uncertain"), "uncertain findings must remain unchanged");
    assert.ok(!decidedIds.has("fnd_protected_batch"), "protected findings must remain unchanged");
  });

  await test("clear_selected only clears selected decisions, not kept/excluded ones", async () => {
    await decisionsPost(
      new Request("http://localhost/api/user-directed/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanId: batchScanId, findingId: "fnd_uncertain", decision: "kept" }),
      })
    );

    const req = new Request("http://localhost/api/user-directed/decisions/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scanId: batchScanId, action: "clear_selected" }),
    });
    const res = await batchPost(req);
    const json = (await res.json()) as { ok?: boolean };
    assert.equal(json.ok, true);

    const listRes = await decisionsGet(
      new Request(`http://localhost/api/user-directed/decisions?scanId=${batchScanId}`)
    );
    const listJson = (await listRes.json()) as { decisions?: Array<{ findingId: string; decision: string }> };
    const byId = new Map((listJson.decisions ?? []).map((d) => [d.findingId, d.decision]));
    assert.equal(byId.has("fnd_safe_1"), false, "selected decisions must be cleared");
    assert.equal(byId.has("fnd_safe_2"), false, "selected decisions must be cleared");
    assert.equal(byId.get("fnd_uncertain"), "kept", "kept decisions must survive Clear selected fixes");
  });

  console.log("findings-workspace-command3c: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
