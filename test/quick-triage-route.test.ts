import assert from "node:assert/strict";
import { POST } from "../src/app/api/a2mcp/quick-triage/route";
import { buildQuickTriageResult } from "../src/lib/a2mcp/quick-triage-response";
import type { Finding } from "../src/lib/findings/types";

function test(name: string, fn: () => Promise<void>) {
  return fn()
    .then(() => console.log(`  ✓ ${name}`))
    .catch((err) => {
      console.error(`  ✗ ${name}`);
      throw err;
    });
}

async function run() {
  console.log("quick-triage-route");

  await test("rejects invalid repository URL", async () => {
    const req = new Request("http://localhost/api/a2mcp/quick-triage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repositoryUrl: "https://gitlab.com/example/repo",
        branch: "main",
        maximumFindings: 5,
      }),
    });
    const res = await POST(req);
    const json = (await res.json()) as { error?: { code?: string } };
    assert.equal(res.status, 422);
    assert.equal(json.error?.code, "UNSUPPORTED_REPOSITORY");
  });

  await test("rejects invalid maximumFindings", async () => {
    const req = new Request("http://localhost/api/a2mcp/quick-triage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repositoryUrl: "https://github.com/vercel/next.js",
        branch: "main",
        maximumFindings: 99,
      }),
    });
    const res = await POST(req);
    const json = (await res.json()) as { error?: { code?: string } };
    assert.equal(res.status, 400);
    assert.equal(json.error?.code, "INVALID_INPUT");
  });

  for (const limit of [1, 5, 10] as const) {
    await test(`contract enforces maximumFindings=${limit}`, async () => {
      const findings: Finding[] = Array.from({ length: 40 }, (_, i) => ({
        id: `f${i}`,
        type: "unused_file",
        title: `Finding ${i}`,
        action: i === 0 ? "safe_candidate" : "review_first",
        confidence: 0.8,
        confidenceReason: "test",
        severity: "medium",
        files: [`src/f${i}.ts`],
        source: "knip",
        sourceMode: "native",
        reason: "test",
        evidence: { summary: "evidence", signals: [] },
        priorityScore: 100 - i,
      }));
      const payload = {
        scanId: "scan_route",
        repo: { owner: "acme", name: "repo", branch: "main" },
        summary: {
          totalFindings: 40,
          duplicateClusters: 0,
          unusedFiles: 40,
          unusedDependencies: 0,
          unusedExports: 0,
          orphanPatterns: 0,
          slopSignals: 0,
          reviewRequired: 39,
          safeCandidates: 1,
          doNotTouch: 0,
        },
        duplicates: [],
        unused: { files: findings, dependencies: [], exports: [] },
        orphans: [],
        slopSignals: [],
        riskBuckets: { safeDelete: ["f0"], reviewFirst: findings.slice(1).map((f) => f.id), doNotTouch: [] },
        artifacts: { findingsJson: true },
        mode: "live" as const,
        rawToolReports: {
          knip: { status: "ok" as const, source: "knip" as const, sourceMode: "native" as const, durationMs: 1 },
          jscpd: { status: "ok" as const, source: "jscpd" as const, sourceMode: "native" as const, durationMs: 1 },
          madge: { status: "ok" as const, source: "madge" as const, sourceMode: "native" as const, durationMs: 1 },
        },
      };
      const result = buildQuickTriageResult(payload, limit);
      assert.equal(result.summary.findingsReturned, limit);
      assert.equal(result.findings.length, limit);
      const bucketSum =
        result.summary.safeCandidates +
        result.summary.reviewFirst +
        result.summary.protected;
      assert.equal(bucketSum, limit);
    });
  }

  console.log("quick-triage-route: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

