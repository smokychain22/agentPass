/**
 * A2A preflight — the free, side-effect-free gate that must pass before any
 * 1 USD₮0 escrow can be funded.
 *
 * It answers one question: "if the user confirmed right now, would funding
 * be safe and correct?" These tests pin that it names every real blocker
 * explicitly, routes to the A2A service rather than A2MCP, and mutates
 * nothing.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "repodiet-a2a-preflight-"));
process.env.REPODIET_DATA_DIR = dataDir;

import type { Finding, FindingsPayload } from "../src/lib/findings/types";
import { storeFindings } from "../src/lib/findings/findings-store";
import { enrichFindingsWithDetectionResolution } from "../src/lib/findings/enrich-detection-resolution";
import { saveFindingDecision } from "../src/lib/user-directed/decision-store";
import { POST as preflightPost } from "../src/app/api/a2a/preflight/route";

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
    evidence: { summary: "test", signals: ["classification=actionable_candidate"] },
    ...overrides,
  };
}

function makePayload(scanId: string, findings: Finding[]): FindingsPayload {
  return {
    scanId,
    repo: {
      owner: "velz-cmd",
      name: "repodiet-e2e-test",
      branch: "main",
      url: "https://github.com/velz-cmd/repodiet-e2e-test",
      commitSha: "c0838e4c",
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

function req(body: unknown) {
  return new Request("http://localhost/api/a2a/preflight", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

type Preflight = {
  ok?: boolean;
  blockers?: string[];
  sellerAgentId?: string;
  buyerAgentId?: string;
  serviceId?: string;
  operation?: string;
  repository?: string;
  selectedCount?: number;
  approvedPlanCount?: number;
  planStatus?: string;
  idempotencyKey?: string;
  githubCapabilities?: Record<string, boolean>;
  runtimeHealth?: Record<string, unknown>;
  transformations?: string[];
};

async function run() {
  console.log("a2a-preflight");

  await test("requires a scanId", async () => {
    const res = await preflightPost(req({}));
    assert.equal(res.status, 400);
  });

  await test("an unknown scan is reported as a blocker, never ok", async () => {
    const res = await preflightPost(req({ scanId: "scan_never_existed" }));
    const json = (await res.json()) as Preflight;
    assert.equal(json.ok, false);
    assert.ok(json.blockers?.some((b) => /stale or unknown/i.test(b)));
  });

  // --- routing identity -------------------------------------------------

  const scanId = "scan_preflight";
  const selected = makeFinding({ id: "fnd_sel", files: ["src/unused.ts"] });
  const protectedFinding = makeFinding({
    id: "fnd_prot",
    files: ["next-env.d.ts"],
    action: "do_not_touch",
    protected: true,
  });
  await storeFindings(
    enrichFindingsWithDetectionResolution(makePayload(scanId, [selected, protectedFinding]))
  );

  await test("routes to A2A service 37348 / create_cleanup_pr, never A2MCP 37347", async () => {
    const res = await preflightPost(req({ scanId }));
    const json = (await res.json()) as Preflight;
    assert.equal(json.serviceId, "37348");
    assert.notEqual(json.serviceId, "37347");
    assert.equal(json.operation, "create_cleanup_pr");
    assert.equal(json.sellerAgentId, "9636");
    assert.equal(json.buyerAgentId, "10466");
  });

  await test("binds to the controlled repository from persisted scan truth", async () => {
    const res = await preflightPost(req({ scanId }));
    const json = (await res.json()) as Preflight;
    assert.equal(json.repository, "velz-cmd/repodiet-e2e-test");
  });

  // --- plan / selection blockers ---------------------------------------

  await test("with no approved plan and nothing selected, funding is blocked", async () => {
    const res = await preflightPost(req({ scanId }));
    const json = (await res.json()) as Preflight;
    assert.equal(json.ok, false);
    // Wording comes from the shared plan-readiness selector, which
    // distinguishes "no plan exists" from "exists but not approved".
    assert.ok(
      json.blockers?.some((b) => /no cleanup plan exists|not been approved/i.test(b)),
      `expected a plan blocker, got: ${json.blockers?.join(" | ")}`
    );
    assert.ok(json.blockers?.some((b) => /at least one selected/i.test(b)));
  });

  await test("a selected protected finding is an explicit blocker", async () => {
    await saveFindingDecision({
      scanId,
      findingId: "fnd_prot",
      decision: "selected",
      analyzedCommit: "c0838e4c",
    });
    const res = await preflightPost(req({ scanId }));
    const json = (await res.json()) as Preflight;
    assert.equal(json.ok, false);
    assert.ok(
      json.blockers?.some((b) => /protected/i.test(b)),
      `expected a protected blocker, got: ${json.blockers?.join(" | ")}`
    );
  });

  await test("GitHub write capability is reported and blocks when unverified", async () => {
    const res = await preflightPost(req({ scanId }));
    const json = (await res.json()) as Preflight;
    assert.equal(typeof json.githubCapabilities?.canCreatePullRequest, "boolean");
    assert.equal(typeof json.githubCapabilities?.canCreateBranch, "boolean");
    assert.equal(typeof json.githubCapabilities?.canPushChanges, "boolean");
    // No GitHub App credentials in this test process -> must fail closed.
    assert.equal(json.githubCapabilities?.canCreatePullRequest, false);
    assert.equal(json.ok, false);
  });

  await test("seller runtime health is reported", async () => {
    const res = await preflightPost(req({ scanId }));
    const json = (await res.json()) as Preflight;
    assert.ok(json.runtimeHealth, "runtimeHealth must be present");
    assert.ok("heartbeatStatus" in (json.runtimeHealth ?? {}));
  });

  await test("a stable idempotency key is prepared for the exact task shape", async () => {
    const a = (await (await preflightPost(req({ scanId }))).json()) as Preflight;
    const b = (await (await preflightPost(req({ scanId }))).json()) as Preflight;
    assert.ok(a.idempotencyKey && a.idempotencyKey.length === 32);
    assert.equal(a.idempotencyKey, b.idempotencyKey, "same task shape must yield the same key");
  });

  await test("preflight is side-effect-free — repeated calls never mutate the decision set", async () => {
    const before = (await (await preflightPost(req({ scanId }))).json()) as Preflight;
    await preflightPost(req({ scanId }));
    await preflightPost(req({ scanId }));
    const after = (await (await preflightPost(req({ scanId }))).json()) as Preflight;
    assert.equal(after.selectedCount, before.selectedCount);
    assert.equal(after.planStatus, before.planStatus);
  });

  await test("responses are never cached", async () => {
    const res = await preflightPost(req({ scanId }));
    assert.equal(res.headers.get("cache-control"), "no-store");
  });

  await test("blockers are explicit strings a user can act on, never a bare false", async () => {
    const res = await preflightPost(req({ scanId }));
    const json = (await res.json()) as Preflight;
    assert.ok(Array.isArray(json.blockers));
    assert.ok((json.blockers?.length ?? 0) > 0);
    for (const b of json.blockers ?? []) {
      assert.equal(typeof b, "string");
      assert.ok(b.length > 10, `blocker too vague: "${b}"`);
    }
  });

  console.log("a2a-preflight: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
