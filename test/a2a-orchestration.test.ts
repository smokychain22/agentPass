import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatA2ATaskResponse } from "../src/lib/a2a/orchestrator";
import { buildInitialTask } from "../src/lib/a2a/task-store";

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

console.log("Phase 4 A2A orchestration tests");

test("agent card route exists", () => {
  assert.ok(fs.existsSync(path.join(ROOT, "src/app/.well-known/agent-card.json/route.ts")));
});

test("A2A task API routes exist", () => {
  for (const route of [
    "src/app/api/a2a/tasks/route.ts",
    "src/app/api/a2a/tasks/[taskId]/route.ts",
    "src/app/api/a2a/tasks/[taskId]/approve/route.ts",
    "src/app/api/a2a/tasks/[taskId]/fund/route.ts",
  ]) {
    assert.ok(fs.existsSync(path.join(ROOT, route)), `missing ${route}`);
  }
});

test("A2A state machine includes approval state", () => {
  const src = fs.readFileSync(path.join(ROOT, "src/lib/a2a/types.ts"), "utf8");
  assert.match(src, /awaiting_approval/);
  assert.match(src, /verification_failed/);
});

test("orchestrator uses execution engine", () => {
  const src = fs.readFileSync(path.join(ROOT, "src/lib/a2a/orchestrator.ts"), "utf8");
  assert.match(src, /executeFreeProof/);
  assert.match(src, /scanRepository/);
  assert.match(src, /createCleanupPullRequest/);
});

test("public cleanup task responses use the canonical OKX operation", () => {
  const task = buildInitialTask(
    "repository.cleanup_pr",
    { repoUrl: "https://github.com/smokychain22/agentPass", branch: "main" },
    {
      owner: "smokychain22",
      name: "agentPass",
      branch: "main",
      url: "https://github.com/smokychain22/agentPass",
    }
  );
  assert.equal(formatA2ATaskResponse(task).operation, "create_cleanup_pr");
});

test("a2a_tasks persistence collection", () => {
  const src = fs.readFileSync(path.join(ROOT, "src/lib/store/persistent-store.ts"), "utf8");
  assert.match(src, /"a2a_tasks"/);
});

test("verify-a2a-production script exists", () => {
  assert.ok(fs.existsSync(path.join(ROOT, "scripts/verify-a2a-production.ts")));
});

console.log("All Phase 4 A2A tests passed.");
