/**
 * RepoDiet smoke tests
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runScan } from "../lib/scanner/analyze.js";
import { generatePatch, buildRegressionContract, regressionMarkdown } from "../lib/scanner/artifacts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PORT = 8790;
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

console.log("\n[unit] demo repo scan");
{
  const demo = path.join(ROOT, "demo-repo");
  const result = await runScan(demo, "quick");
  assert(result.framework === "Next.js", "detects Next.js");
  assert(result.findings.length >= 5, `findings count ${result.findings.length} >= 5`);
  assert(result.summary.duplicate_clusters >= 1, "duplicate clusters");
  assert(result.summary.unused_dependencies >= 1, "unused deps");
  assert(result.summary.bloat_score > 0, "bloat score > 0");

  const patch = generatePatch(result.findings, demo);
  assert(patch.includes("RepoDiet"), "patch generated");
  const contract = buildRegressionContract(demo, result.framework, result.findings);
  const md = regressionMarkdown(contract);
  assert(md.includes("Regression Contract"), "regression md");
}

console.log("\n[http] server");
const child = spawn("node", ["server.js"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), REPODIET_DATA_DIR: path.join(ROOT, "data-test") },
  stdio: ["ignore", "pipe", "pipe"],
});

for (let i = 0; i < 40; i++) {
  try {
    const r = await fetch(`${BASE}/api/health`);
    if (r.ok) break;
  } catch {
    /* wait */
  }
  await sleep(100);
}

{
  const h = await fetch(`${BASE}/api/health`).then((r) => r.json());
  assert(h.data.service === "RepoDiet", "health");

  const demo = await fetch(`${BASE}/api/scans/demo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then((r) => r.json());
  assert(demo.ok, "demo scan");
  const id = demo.data.scan.id;

  const findings = await fetch(`${BASE}/api/scans/${id}/findings`).then((r) => r.json());
  assert(findings.data.findings.length > 0, "findings api");

  const patch = await fetch(`${BASE}/api/scans/${id}/generate-patch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then((r) => r.json());
  assert(patch.data.bundle.patch_text, "patch bundle");

  const headers = { "Content-Type": "application/json", "X-RepoDiet-Demo-Pay": "1" };
  const tool = await fetch(`${BASE}/api/tools/scan_repo_bloat`, { method: "POST", headers, body: JSON.stringify({ demo: true }) }).then((r) => r.json());
  assert(tool.ok, "a2mcp scan_repo_bloat");

  const naked = await fetch(`${BASE}/api/tools/scan_repo_bloat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert(naked.status === 402, "402 without payment");
}

child.kill("SIGTERM");
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
