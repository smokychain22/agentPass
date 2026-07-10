#!/usr/bin/env node
/**
 * Phase 1 acceptance: real scan → findings → free cleanup on demo repo.
 * Uses HTTP against a running Next server (avoids tsx/execa import chain in test runner).
 *
 * Usage:
 *   npm run build && PORT=3099 npm start &
 *   REPODIET_LOCAL_URL=http://127.0.0.1:3099 node scripts/phase1-integration-test.mjs
 *
 * Or set REPODIET_START_SERVER=1 to spawn `npm start` automatically.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const DEMO_REPO = "https://github.com/repodiet/demo-slop-app";
const PORT = Number(process.env.PORT || 3099);
const BASE =
  process.env.REPODIET_LOCAL_URL ||
  process.env.REPODIET_PRODUCTION_URL ||
  `http://127.0.0.1:${PORT}`;

let serverProc = null;

async function waitForHealth(timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/tools/health`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await sleep(1500);
  }
  throw new Error(`Server not healthy at ${BASE}`);
}

async function maybeStartServer() {
  if (process.env.REPODIET_START_SERVER !== "1") return;
  serverProc = spawn("npm", ["start"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, PORT: String(PORT) },
    stdio: "ignore",
  });
  await waitForHealth();
}

async function stopServer() {
  if (!serverProc) return;
  serverProc.kill("SIGTERM");
  await sleep(500);
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function main() {
  console.log(`Phase 1 integration: ${BASE}`);
  await maybeStartServer();
  await waitForHealth();

  const findingsRes = await fetch(`${BASE}/api/findings/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoUrl: DEMO_REPO }),
  });
  const findingsJson = await findingsRes.json();
  assert(findingsRes.ok && findingsJson.success, `findings failed: ${findingsJson.error || findingsRes.status}`);

  const findings = findingsJson.findings;
  const flat = [
    ...findings.duplicates,
    ...findings.unused.files,
    ...findings.unused.dependencies,
    ...findings.unused.exports,
    ...findings.orphans,
    ...findings.slopSignals,
  ];
  const eligible = flat.filter((f) => f.action === "safe_candidate");
  console.log(`Findings: ${flat.length}, safe_candidate: ${eligible.length}`);

  const cleanupRes = await fetch(`${BASE}/api/cleanup/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ findings }),
  });
  const cleanupJson = await cleanupRes.json();
  assert(cleanupRes.ok && cleanupJson.success, `cleanup failed: ${cleanupJson.error || cleanupRes.status}`);

  const cleanup = cleanupJson.cleanup;
  const proof = cleanup.proof;
  console.log(`Decision: ${proof?.finalDecision}`);
  console.log(`Finding: ${proof?.selectedFindingId}`);
  console.log(`Changed: ${(proof?.changedFiles || []).join(", ")}`);
  console.log(`States: ${(cleanup.stateTransitions || []).map((s) => s.state).join(" → ")}`);

  assert(proof?.selectedFindingId, "missing selectedFindingId");
  assert((proof?.changedFiles || []).length > 0, "no changed files");
  assert(cleanup.unifiedDiff?.includes("diff --git"), "missing real unified diff");
  assert(
    proof.finalDecision === "retained" || proof.finalDecision === "rejected",
    `unexpected decision: ${proof.finalDecision}`
  );

  if (proof.finalDecision === "retained") {
    assert(cleanup.metrics?.linesAdded >= 0 || cleanup.metrics?.linesRemoved > 0, "no diff metrics");
    assert((proof.changedFiles || []).length === 1, "free proof must change exactly one file");
    const attempt =
      cleanup.fixLoop?.attempts?.find((a) => a.status === "retained") ?? cleanup.fixLoop?.attempts?.[0];
    assert(attempt?.comparison?.length > 0, "missing check comparison");
    console.log(`Diff +/-: ${cleanup.metrics.linesAdded}/${cleanup.metrics.linesRemoved}`);
  } else {
    console.log(`Honest rejection: ${cleanup.fixLoop?.attempts?.[0]?.reason || "unknown"}`);
  }

  console.log("PASS");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => stopServer());
