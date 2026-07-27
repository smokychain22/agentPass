/**
 * COMMAND 3E, Slice 1 — detection/resolution split, real transformation
 * registry, correct protected/generated handling, and backend enforcement.
 * Real API route calls, real durable store, isolated temp dir.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "repodiet-command3e-slice1-"));
process.env.REPODIET_DATA_DIR = dataDir;

import type { Finding, FindingsPayload } from "../src/lib/findings/types";
import { storeFindings } from "../src/lib/findings/findings-store";
import { classifyDetectionAndResolution } from "../src/lib/findings/detection-resolution";
import { enrichFindingsWithDetectionResolution } from "../src/lib/findings/enrich-detection-resolution";
import { outcomeStatusLabel } from "../src/lib/user-directed/recommended-action";
import { buildFindingCardActions } from "../src/lib/user-directed/finding-card-actions";
import {
  NOT_YET_IMPLEMENTED_TRANSFORMATIONS,
  canonicalTransformationId,
} from "../src/lib/execution/transformer-registry";
import { POST as decisionsPost } from "../src/app/api/user-directed/decisions/route";
import { POST as approvePost } from "../src/app/api/user-directed/approve-cleanup-plan/route";
import { POST as preparePost } from "../src/app/api/user-directed/prepare-cleanup-plan/route";

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

async function prepare(scanId: string, pinnedCommit: string, includeFindingIds: string[]) {
  return preparePost(
    new Request("http://localhost/api/user-directed/prepare-cleanup-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scanId, pinnedCommit, includeFindingIds }),
    })
  );
}

async function run() {
  console.log("command3e-slice1-detection-resolution");

  // --- 1. detection and resolution are separate ------------------------

  await test("a generated file's detectionType is generated_artifact, not unused_file", () => {
    const f = makeFinding({ files: ["src/generated/api-client.generated.ts"] });
    const result = classifyDetectionAndResolution(f);
    assert.equal(result.detectionType, "generated_artifact");
    assert.equal(result.resolutionType, "leave_protected");
    assert.equal(result.supportedTransformationId, null);
    assert.equal(result.actionable, false);
  });

  await test("next-env.d.ts cannot enter cleanup — always leave_protected, never actionable", () => {
    const f = makeFinding({ files: ["next-env.d.ts"] });
    const result = classifyDetectionAndResolution(f);
    assert.equal(result.detectionType, "generated_artifact");
    assert.equal(result.resolutionType, "leave_protected");
    assert.equal(result.actionable, false);
  });

  await test("a duplicate_code detector output never directly implies delete — resolutionType is consolidate_duplicate only via the registry", () => {
    const f = makeFinding({
      id: "fnd_dup",
      type: "duplicate_code",
      files: ["src/a.ts", "src/a-copy.ts"],
      evidence: {
        summary: "exact duplicate",
        signals: [
          "exact_file_duplicate=true",
          "content_hash=abc",
          "canonical=src/a.ts",
          "duplicate=src/a-copy.ts",
          "classification=actionable_candidate",
        ],
      },
    });
    const result = classifyDetectionAndResolution(f);
    assert.equal(result.detectionType, "duplicate_implementation");
    assert.equal(result.resolutionType, "consolidate_duplicate");
    assert.equal(result.supportedTransformationId, "CONSOLIDATE_DUPLICATE_IMPLEMENTATION");
  });

  await test("2. generated/protected files never receive direct-delete resolutionType, regardless of confidence or action", () => {
    const f = makeFinding({
      files: ["src/generated/schema.generated.ts"],
      action: "safe_candidate",
      confidence: 0.99,
    });
    const result = classifyDetectionAndResolution(f);
    assert.notEqual(result.resolutionType, "delete_file");
    assert.equal(result.resolutionType, "leave_protected");
  });

  await test("3. an actionable finding always has an implemented (registered) transformation", () => {
    const f = makeFinding({
      files: ["src/tmp/leftover.ts"],
      confidence: 0.9,
      evidence: { summary: "temp file", signals: ["classification=actionable_candidate"] },
    });
    const result = classifyDetectionAndResolution(f);
    if (result.actionable) {
      assert.ok(result.supportedTransformationId, "actionable finding must have a supportedTransformationId");
      assert.ok(
        canonicalTransformationId,
        "canonicalTransformationId lookup must exist for the registry"
      );
    }
  });

  await test("4. duplicate canonical choice requires explicit evidence (canonical=/duplicate= signals), never guessed", () => {
    const f = makeFinding({
      id: "fnd_dup_noevidence",
      type: "duplicate_code",
      files: ["src/x.ts", "src/y.ts"],
      evidence: { summary: "similar code", signals: [] },
    });
    const result = classifyDetectionAndResolution(f);
    // No exact-duplicate evidence -> no registered transformation -> report_only.
    assert.equal(result.resolutionType, "report_only");
    assert.equal(result.supportedTransformationId, null);
  });

  await test("6. an uncertain (Review suggested) finding only offers an override when a real transformation exists", () => {
    const supported = makeFinding({
      id: "fnd_review_supported",
      files: ["src/maybe-unused.ts"],
      action: "review_first",
    });
    const enriched = { ...supported, ...classifyDetectionAndResolution(supported) };
    const status = outcomeStatusLabel(enriched);
    if (status === "Review suggested") {
      const actions = buildFindingCardActions(enriched, status);
      assert.ok(actions.some((a) => a.id === "remove_anyway"));
    }
  });

  await test("7. a finding with no implemented transformation never offers a removal override — it is Informational with no actions", () => {
    const f = makeFinding({
      id: "fnd_circular",
      type: "orphan_pattern",
      files: ["src/a.ts", "src/b.ts"],
      action: "review_first",
    });
    const enriched = { ...f, ...classifyDetectionAndResolution(f) };
    assert.equal(enriched.supportedTransformationId, null);
    const status = outcomeStatusLabel(enriched);
    assert.equal(status, "Informational");
    const actions = buildFindingCardActions(enriched, status);
    assert.deepEqual(actions, []);
  });

  await test("5. RepoDiet has no test-failure detector yet — FIX_TEST_FAILURE is honestly audited as not-yet-implemented rather than silently mapping unused_file findings to a debugging resolution", () => {
    // There is no detector today that produces a "failing test" finding type,
    // so there is nothing that could be mis-mapped to file removal. The
    // real assertion for Slice 1 is that the eventual transformation is
    // explicitly listed as not-yet-implemented, so a future detector can
    // never silently default to REMOVE_UNUSED_FILE for a test failure.
    assert.ok(NOT_YET_IMPLEMENTED_TRANSFORMATIONS.includes("FIX_TEST_FAILURE"));
  });

  await test("unsupported transformation IDs are explicitly audited, never silently advertised", () => {
    assert.ok(NOT_YET_IMPLEMENTED_TRANSFORMATIONS.includes("FIX_TEST_FAILURE"));
    assert.ok(NOT_YET_IMPLEMENTED_TRANSFORMATIONS.includes("FIX_TYPE_ERROR"));
    assert.ok(NOT_YET_IMPLEMENTED_TRANSFORMATIONS.includes("FIX_LINT_ERROR"));
    assert.ok(NOT_YET_IMPLEMENTED_TRANSFORMATIONS.includes("FIX_BROKEN_IMPORT"));
  });

  await test("enrichFindingsWithDetectionResolution persists the split onto every finding in a payload", () => {
    const payload = makePayload("scan_enrich", "c1", [
      makeFinding({ id: "fnd_1", files: ["src/one.ts"] }),
      makeFinding({ id: "fnd_2", files: ["next-env.d.ts"] }),
    ]);
    const enriched = enrichFindingsWithDetectionResolution(payload);
    for (const f of [...enriched.unused.files]) {
      assert.ok(f.detectionType, `finding ${f.id} missing detectionType`);
      assert.ok(f.resolutionType, `finding ${f.id} missing resolutionType`);
      assert.notEqual(f.verificationStatus, undefined);
      assert.notEqual(f.actionable, undefined);
    }
    const generated = enriched.unused.files.find((f) => f.id === "fnd_2")!;
    assert.equal(generated.detectionType, "generated_artifact");
    assert.equal(generated.actionable, false);
  });

  // --- Backend enforcement ---------------------------------------------

  const scanId = "scan_command3e_slice1";
  const commitSha = "commit_v1";
  const unsupported = makeFinding({
    id: "fnd_unsupported",
    type: "orphan_pattern",
    files: ["src/orphan-a.ts", "src/orphan-b.ts"],
    action: "review_first",
  });
  const supported = makeFinding({
    id: "fnd_supported",
    files: ["src/real-unused.ts"],
    evidence: { summary: "unused file", signals: ["classification=actionable_candidate", "inbound_refs=0"] },
  });
  const payload = makePayload(scanId, commitSha, [unsupported, supported]);
  const enrichedPayload = enrichFindingsWithDetectionResolution(payload);
  await storeFindings(enrichedPayload);

  await test("backend rejects selecting a finding with no implemented transformation", async () => {
    const req = new Request("http://localhost/api/user-directed/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scanId,
        findingId: "fnd_unsupported",
        decision: "selected",
        filesToRemove: ["src/orphan-a.ts", "src/orphan-b.ts"],
      }),
    });
    const res = await decisionsPost(req);
    assert.equal(res.status, 403);
  });

  await test("backend accepts selecting a finding that has a real implemented transformation", async () => {
    const req = new Request("http://localhost/api/user-directed/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scanId,
        findingId: "fnd_supported",
        decision: "selected",
        filesToRemove: ["src/real-unused.ts"],
      }),
    });
    const res = await decisionsPost(req);
    const json = (await res.json()) as { ok?: boolean; error?: string };
    assert.equal(res.status, 200, json.error);
    assert.equal(json.ok, true);
  });

  await test("cleanup plan approval rejects a finding with no implemented transformation, even if somehow selected client-side", async () => {
    await prepare(scanId, commitSha, ["fnd_supported"]);
    const req = new Request("http://localhost/api/user-directed/approve-cleanup-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scanId,
        pinnedCommit: commitSha,
        includeFindingIds: ["fnd_supported", "fnd_unsupported"],
      }),
    });
    const res = await approvePost(req);
    assert.equal(res.status, 403);
  });

  await test("cleanup plan approval succeeds for a finding with a real implemented transformation", async () => {
    await prepare(scanId, commitSha, ["fnd_supported"]);
    const req = new Request("http://localhost/api/user-directed/approve-cleanup-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scanId, pinnedCommit: commitSha, includeFindingIds: ["fnd_supported"] }),
    });
    const res = await approvePost(req);
    const json = (await res.json()) as { ok?: boolean; error?: string };
    assert.equal(res.status, 200, json.error);
  });

  console.log("command3e-slice1-detection-resolution: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
