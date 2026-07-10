import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("Phase 3 A2MCP tests");

test("phase3 API routes exist", () => {
  const routes = [
    "src/app/api/tools/scan_repository/route.ts",
    "src/app/api/tools/analyze_repository/route.ts",
    "src/app/api/tools/get_findings/route.ts",
    "src/app/api/tools/list_safe_fixes/route.ts",
    "src/app/api/tools/get_repository_health/route.ts",
    "src/app/api/tools/run_free_safe_fix/route.ts",
    "src/app/api/tools/run_cleanup/route.ts",
    "src/app/api/tools/tasks/[taskId]/route.ts",
  ];
  for (const route of routes) {
    assert.ok(fs.existsSync(path.join(ROOT, route)), `missing ${route}`);
  }
});

test("manifest includes phase3 agent flow tools", () => {
  const manifest = fs.readFileSync(path.join(ROOT, "src/lib/a2mcp/phase3-manifest.ts"), "utf8");
  for (const tool of [
    "scan_repository",
    "analyze_repository",
    "list_safe_fixes",
    "run_free_safe_fix",
    "get_task_status",
  ]) {
    assert.match(manifest, new RegExp(`name: "${tool}"`));
  }
});

test("tool contract defines success and taskId", () => {
  const contract = fs.readFileSync(path.join(ROOT, "src/lib/a2mcp/tool-contract.ts"), "utf8");
  assert.match(contract, /success: boolean/);
  assert.match(contract, /taskId: string/);
  assert.match(contract, /analyzers:/);
});

test("verify-asp-production script exists", () => {
  assert.ok(fs.existsSync(path.join(ROOT, "scripts/verify-asp-production.ts")));
});

test("tasks collection in persistent store", () => {
  const store = fs.readFileSync(path.join(ROOT, "src/lib/store/persistent-store.ts"), "utf8");
  assert.match(store, /"tasks"/);
});

console.log("All Phase 3 A2MCP tests passed.");
