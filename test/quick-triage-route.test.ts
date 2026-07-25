import assert from "node:assert/strict";
import { POST } from "../src/app/api/a2mcp/quick-triage/route";
import { buildQuickTriageResult } from "../src/lib/a2mcp/quick-triage-response";
import type { Finding } from "../src/lib/findings/types";
import {
  getAgentRuntimeHealth,
  touchAgentRuntimeHealth,
} from "../src/lib/a2a/agent-runtime-health";
import { runPhase3ToolRoute } from "../src/lib/a2mcp/phase3-route";

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

  await test("rejects invalid JSON before payment handling", async () => {
    const req = new Request("http://localhost/api/a2mcp/quick-triage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"repositoryUrl":',
    });
    const res = await POST(req);
    const json = (await res.json()) as { error?: { code?: string } };
    assert.equal(res.status, 400);
    assert.equal(json.error?.code, "INVALID_INPUT");
    assert.equal(res.headers.has("PAYMENT-REQUIRED"), false);
  });

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

  await test("a valid payment-required response records A2MCP reachability", async () => {
    const previousRequireRealX402 = process.env.REQUIRE_REAL_X402;
    const previousAppUrl = process.env.NEXT_PUBLIC_APP_URL;
    process.env.REQUIRE_REAL_X402 = "1";
    process.env.NEXT_PUBLIC_APP_URL = "https://skillswap-virid-kappa.vercel.app";
    try {
      await touchAgentRuntimeHealth({ a2mcpEndpointHealthy: false });
      const response = await runPhase3ToolRoute(
        "analyze_repository",
        new Request("https://skillswap-virid-kappa.vercel.app/api/a2mcp/quick-triage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repoUrl: "https://github.com/acme/example",
            branch: "main",
            commitSha: "a".repeat(40),
          }),
        }),
        async () => {
          throw new Error("handler must not run before payment");
        }
      );
      assert.equal(response.status, 402);
      const health = await getAgentRuntimeHealth();
      assert.equal(health.a2mcpEndpointHealthy, true);
    } finally {
      if (previousRequireRealX402 === undefined) delete process.env.REQUIRE_REAL_X402;
      else process.env.REQUIRE_REAL_X402 = previousRequireRealX402;
      if (previousAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = previousAppUrl;
    }
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

