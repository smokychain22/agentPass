import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findingFingerprint } from "../src/lib/guard/fingerprint";
import { analyzeGuardDelta } from "../src/lib/guard/delta-analysis";
import { loadRepositoryMemory, recordRejectedFinding } from "../src/lib/guard/repository-memory";
import type { Finding, FindingsPayload } from "../src/lib/findings/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    await fn();
    console.log(`  ✓ ${name}`);
  })();
}

function sampleFinding(id: string, type: Finding["type"] = "unused_import"): Finding {
  return {
    id,
    type,
    title: `Finding ${id}`,
    files: [`src/${id}.ts`],
    confidence: 0.9,
    confidenceReason: "test",
    severity: "low",
    action: "safe_candidate",
    reason: "test",
    source: "heuristic",
    sourceMode: "heuristic",
    evidence: { summary: "test evidence", signals: ["unused"] },
  };
}

function payload(scanId: string, findings: Finding[]): FindingsPayload {
  return {
    scanId,
    repo: { owner: "owner", name: "repo", branch: "main", commitSha: scanId },
    summary: {
      totalFindings: findings.length,
      duplicateClusters: 0,
      unusedFiles: 0,
      unusedDependencies: 0,
      unusedExports: findings.length,
      orphanPatterns: 0,
      slopSignals: 0,
      reviewRequired: 0,
      safeCandidates: findings.length,
      doNotTouch: 0,
    },
    duplicates: [],
    unused: { files: [], dependencies: [], exports: findings },
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
  console.log("Phase 6 Repo Guard tests");

  await test("guard module files exist", () => {
    for (const f of [
      "src/lib/guard/guard-engine.ts",
      "src/lib/guard/delta-analysis.ts",
      "src/app/api/github/webhook/route.ts",
      "src/app/api/guard/run/route.ts",
      "scripts/verify-guard-production.ts",
      "scripts/full-production-smoke-test.ts",
    ]) {
      assert.ok(fs.existsSync(path.join(ROOT, f)), f);
    }
  });

  await test("delta analysis detects new and resolved findings", async () => {
    const f1 = sampleFinding("f1");
    const f2 = sampleFinding("f2");
    const memory = await loadRepositoryMemory("owner/repo");
    const delta = await analyzeGuardDelta({
      memory,
      previousScanId: "scan_old",
      currentScanId: "scan_new",
      previousCommitSha: "abc",
      currentCommitSha: "def",
      currentFindings: payload("scan_new", [f2]),
    });
    const { storeFindings } = await import("../src/lib/findings/findings-store");
    await storeFindings(payload("scan_old", [f1]));
    const delta2 = await analyzeGuardDelta({
      memory,
      previousScanId: "scan_old",
      currentScanId: "scan_new",
      previousCommitSha: "abc",
      currentCommitSha: "def",
      currentFindings: payload("scan_new", [f2]),
    });
    assert.equal(delta2.newFindings.length, 1);
    assert.equal(delta2.resolvedFindings.length, 1);
    assert.equal(delta2.newFindings[0].id, "f2");
    void delta;
  });

  await test("rejected findings stay suppressed", async () => {
    const f = sampleFinding("ignored1");
    const { findingEvidenceHash } = await import("../src/lib/guard/fingerprint");
    const fp = findingFingerprint(f);
    const evidenceHash = findingEvidenceHash(f);
    await recordRejectedFinding("owner/repo", {
      fingerprint: fp,
      findingType: f.type,
      title: f.title,
      rejectedAt: new Date().toISOString(),
      evidenceHash,
    });
    const memory = await loadRepositoryMemory("owner/repo");
    const delta = await analyzeGuardDelta({
      memory,
      currentScanId: "scan_ignored",
      currentCommitSha: "sha",
      currentFindings: payload("scan_ignored", [f]),
    });
    assert.equal(delta.newFindings.length, 0);
    assert.equal(delta.ignoredFindings.length, 1);
  });

  await test("rejected finding resurfaces when evidence changes", async () => {
    const f = sampleFinding("ignored2");
    f.evidence = { summary: "changed evidence", signals: ["new-signal"] };
    const fp = findingFingerprint(f);
    await recordRejectedFinding("owner/repo2", {
      fingerprint: fp,
      findingType: f.type,
      title: f.title,
      rejectedAt: new Date().toISOString(),
      evidenceHash: "sha256:old",
    });
    const memory = await loadRepositoryMemory("owner/repo2");
    const delta = await analyzeGuardDelta({
      memory,
      currentScanId: "scan_resurface",
      currentCommitSha: "sha2",
      currentFindings: payload("scan_resurface", [f]),
    });
    assert.equal(delta.newFindings.length, 1);
    assert.equal(delta.ignoredFindings.length, 0);
  });

  await test("webhook helper skips trivial push", async () => {
    const { shouldScanForPush } = await import("../src/lib/guard/webhook-helpers");
    const decision = shouldScanForPush({ changedFiles: ["README.md"] });
    assert.equal(decision.scan, false);
  });

  console.log("All Phase 6 Repo Guard tests passed.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
