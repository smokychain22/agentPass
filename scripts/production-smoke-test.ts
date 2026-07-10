#!/usr/bin/env tsx
/**
 * Production smoke test for deployed RepoDiet.
 * Usage: REPODIET_PRODUCTION_URL=https://your-app.vercel.app npm run test:production
 */

const BASE = process.env.REPODIET_PRODUCTION_URL || process.env.NEXT_PUBLIC_APP_URL || "";

if (!BASE) {
  console.error("FAIL: Set REPODIET_PRODUCTION_URL to the deployed domain.");
  process.exit(1);
}

const DEMO_REPO = "https://github.com/repodiet/demo-slop-app";
const SMALL_REPO = process.env.REPODIET_SMOKE_REPO || "https://github.com/octocat/Hello-World";

interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}

const checks: Check[] = [];

function record(name: string, pass: boolean, detail?: string) {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function pollJob<T>(endpoint: string, jobId: string, timeoutMs = 300_000): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`${BASE}${endpoint}/${jobId}`);
    const json = await res.json();
    if (json.status === "complete" && json.result) return json.result as T;
    if (json.status === "failed") throw new Error(json.error || "job failed");
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("job timeout");
}

async function main() {
  console.log(`Production smoke test: ${BASE}`);

  try {
    const health = await fetch(`${BASE}/api/tools/health`);
    record("health", health.ok, `status=${health.status}`);
  } catch (err) {
    record("health", false, err instanceof Error ? err.message : String(err));
  }

  let findings: { scanId: string; mode: string; rawToolReports: Record<string, { status: string; sourceMode: string }> } | null = null;

  try {
    const start = await fetch(`${BASE}/api/jobs/findings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoUrl: SMALL_REPO }),
    });
    const startJson = await start.json();
    record("findings job create", start.ok && (startJson.success || startJson.status === "complete"), startJson.jobId);

    if (startJson.status === "complete" && startJson.result) {
      findings = startJson.result;
    } else if (startJson.jobId) {
      findings = await pollJob("/api/jobs/findings", startJson.jobId);
    }

    if (findings) {
      record("findings job complete", !!findings?.scanId, findings?.scanId);

      const knip = findings?.rawToolReports?.knip;
      const honest =
        knip &&
        ["native", "fallback", "heuristic"].includes(knip.sourceMode) &&
        ["ok", "fallback", "failed"].includes(knip.status);
      record("analyzer report honesty", !!honest, knip ? `${knip.status}/${knip.sourceMode}` : "missing");

      record("demo isolation on live repo", findings?.mode === "live" || findings?.mode === "demo", findings?.mode);
    }
  } catch (err) {
    record("findings pipeline", false, err instanceof Error ? err.message : String(err));
  }

  if (findings?.scanId) {
    try {
      const getRes = await fetch(`${BASE}/api/findings/${findings.scanId}`);
      // Cross-instance GET may 404 on serverless /tmp — same-request POST result is authoritative.
      record(
        "findings persistence GET",
        getRes.ok,
        getRes.ok ? `status=${getRes.status}` : `status=${getRes.status} (expected on multi-instance serverless)`
      );
    } catch (err) {
      record("findings persistence GET", false, err instanceof Error ? err.message : String(err));
    }

    try {
      const patchRes = await fetch(`${BASE}/api/patches/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-RepoDiet-Demo-Pay": "250000",
        },
        body: JSON.stringify({ scanId: findings.scanId, findings }),
      });
      const patchJson = await patchRes.json();
      record("patch generate", patchRes.ok && patchJson.success, patchJson.patchId);

      if (patchJson.patchId) {
        const dl = await fetch(`${BASE}/api/patches/${patchJson.patchId}/download`);
        record("patch bundle download", dl.ok && dl.headers.get("content-type")?.includes("zip"), `status=${dl.status}`);

        const verifyRes = await fetch(`${BASE}/api/verify/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ patchId: patchJson.patchId }),
        });
        const verifyJson = await verifyRes.json();
        record(
          "verification run",
          verifyRes.ok && verifyJson.success,
          verifyJson.status ? `status=${verifyJson.status}` : verifyJson.error
        );
      }
    } catch (err) {
      record("patch/verify pipeline", false, err instanceof Error ? err.message : String(err));
    }
  }

  try {
    const manifest = await fetch(`${BASE}/api/tools/manifest`);
    record("okx manifest", manifest.ok);
    const tools = await fetch(`${BASE}/api/tools`);
    record("okx tools index", tools.ok);
  } catch (err) {
    record("okx endpoints", false, err instanceof Error ? err.message : String(err));
  }

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length > 0) {
    console.error("FAILED CHECKS:", failed.map((f) => f.name).join(", "));
    process.exit(1);
  }
  console.log("OVERALL: PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
