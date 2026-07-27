/**
 * COMMAND 3E, Slice 2 — automated verification pipeline. Real bounded
 * reference-search check against a real local fixture directory (no
 * network), real durable verification-record store, and real API-level
 * authorization checks (protected / unsupported findings are rejected
 * before any workspace is ever prepared).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "repodiet-command3e-slice2-"));
process.env.REPODIET_DATA_DIR = dataDir;

import type { Finding, FindingsPayload } from "../src/lib/findings/types";
import { storeFindings } from "../src/lib/findings/findings-store";
import { enrichFindingsWithDetectionResolution } from "../src/lib/findings/enrich-detection-resolution";
import { runBoundedReferenceVerification } from "../src/lib/execution/verification-pipeline";
import {
  appendVerificationRecord,
  listVerificationRecords,
} from "../src/lib/user-directed/verification-store";
import { POST as verifyFindingPost } from "../src/app/api/user-directed/verify-finding/route";

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
  console.log("command3e-slice2-verification-pipeline");

  // --- real bounded reference-search check against a local fixture -----

  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "repodiet-verify-fixture-"));
  await fsp.writeFile(
    path.join(fixtureDir, "truly-unused.ts"),
    "export const truly = 'unused';\n"
  );
  await fsp.writeFile(
    path.join(fixtureDir, "still-referenced.ts"),
    "export const stillReferenced = 1;\n"
  );
  await fsp.writeFile(
    path.join(fixtureDir, "consumer.ts"),
    "import { stillReferenced } from './still-referenced';\nconsole.log(stillReferenced);\n"
  );

  await test("a file with zero real references passes bounded verification", async () => {
    const f = makeFinding({ id: "fnd_unused", files: ["truly-unused.ts"] });
    const outcome = await runBoundedReferenceVerification(f, { rootDir: fixtureDir });
    assert.equal(outcome.result, "passed");
    assert.equal(outcome.exitCode, 0);
    assert.match(outcome.resultSummary, /No inbound/);
  });

  await test("a file with a real inbound reference fails bounded verification and names the importer", async () => {
    const f = makeFinding({ id: "fnd_referenced", files: ["still-referenced.ts"] });
    const outcome = await runBoundedReferenceVerification(f, { rootDir: fixtureDir });
    assert.equal(outcome.result, "failed");
    assert.equal(outcome.exitCode, 1);
    assert.match(outcome.resultSummary, /consumer\.ts/);
  });

  await test("verification records persist and are queryable per finding", async () => {
    const scanId = "scan_verify_store_test";
    const findingId = "fnd_store_test";
    const outcome = await runBoundedReferenceVerification(
      makeFinding({ id: findingId, files: ["truly-unused.ts"] }),
      { rootDir: fixtureDir }
    );
    await appendVerificationRecord({ ...outcome, scanId, findingId, commitSha: "c1" });
    const records = await listVerificationRecords(scanId, findingId);
    assert.equal(records.length, 1);
    assert.equal(records[0].result, "passed");
    assert.equal(records[0].commitSha, "c1");
  });

  // --- API-level authorization (no network / workspace required) -------

  const scanId = "scan_verify_api_test";
  const commitSha = "commit_v1";
  const protectedFinding = makeFinding({
    id: "fnd_protected",
    files: ["next-env.d.ts"],
    action: "do_not_touch",
    protected: true,
  });
  const unsupportedFinding = makeFinding({
    id: "fnd_unsupported",
    type: "orphan_pattern",
    files: ["src/orphan-a.ts", "src/orphan-b.ts"],
    action: "review_first",
  });
  const payload = enrichFindingsWithDetectionResolution(
    makePayload(scanId, commitSha, [protectedFinding, unsupportedFinding])
  );
  await storeFindings(payload);

  await test("verify-finding rejects protected findings before any workspace is prepared", async () => {
    const req = new Request("http://localhost/api/user-directed/verify-finding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scanId, findingId: "fnd_protected" }),
    });
    const res = await verifyFindingPost(req);
    assert.equal(res.status, 403);
  });

  await test("verify-finding rejects findings with no implemented transformation before any workspace is prepared", async () => {
    const req = new Request("http://localhost/api/user-directed/verify-finding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scanId, findingId: "fnd_unsupported" }),
    });
    const res = await verifyFindingPost(req);
    assert.equal(res.status, 403);
  });

  await test("verify-finding rejects unknown scanId/findingId", async () => {
    const res1 = await verifyFindingPost(
      new Request("http://localhost/api/user-directed/verify-finding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanId: "scan_never_existed", findingId: "fnd_x" }),
      })
    );
    assert.equal(res1.status, 404);

    const res2 = await verifyFindingPost(
      new Request("http://localhost/api/user-directed/verify-finding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanId, findingId: "fnd_does_not_exist" }),
      })
    );
    assert.equal(res2.status, 404);
  });

  console.log("command3e-slice2-verification-pipeline: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
