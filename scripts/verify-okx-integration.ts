#!/usr/bin/env tsx
/**
 * Verify OKX/A2MCP public endpoints against a deployed RepoDiet instance.
 */

const BASE = process.env.REPODIET_PRODUCTION_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const REPO = process.env.REPODIET_OKX_TEST_REPO || "https://github.com/repodiet/demo-slop-app";

async function assertOk(name: string, res: Response) {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${name} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  console.log(`PASS ${name}`);
}

async function main() {
  console.log(`OKX integration verify: ${BASE}`);

  const manifestRes = await fetch(`${BASE}/api/tools/manifest`);
  await assertOk("manifest", manifestRes);
  const manifest = await manifestRes.json();

  const healthRes = await fetch(`${BASE}/api/tools/health`);
  await assertOk("health", healthRes);

  const toolNames: string[] =
    manifest.tools?.map((t: { name: string }) => t.name) ??
    [
      "scan_repo_bloat",
      "detect_duplicate_code",
      "find_dead_files",
      "find_unused_dependencies",
      "find_orphan_patterns",
      "generate_cleanup_patch",
      "generate_regression_checklist",
    ];

  for (const tool of toolNames) {
    const res = await fetch(`${BASE}/api/tools/${tool}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoUrl: REPO }),
    });
    await assertOk(`tool:${tool}`, res);
    const json = await res.json();
    if (json.demo === true && !REPO.includes("demo")) {
      throw new Error(`${tool} returned demo/static payload for non-demo repo`);
    }
  }

  console.log("OVERALL: PASS");
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
