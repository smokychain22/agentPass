import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * PR A adds a server-side claim/verify/complete model for external sandbox
 * workers (new store fields + new /api/internal/actions/sandbox-runs/*
 * routes), but it must be completely inert in production until a follow-up
 * PR actually dispatches a GitHub Actions workflow to use it.
 *
 * This pins that `dispatchSandboxExecution` still does exactly what it did
 * before this change: in the serverless runtime it POSTs to the same
 * git-less Vercel `/api/internal/sandbox-runs/execute` route it always has.
 * If a future change to `dispatch-sandbox-execution.ts` starts firing a
 * `repository_dispatch` instead, that is PR B's deliberate, reviewed change —
 * not a silent side effect of this one.
 */

const DISPATCH_SRC = readFileSync(
  path.join(process.cwd(), "src/lib/execution/dispatch-sandbox-execution.ts"),
  "utf8"
);

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("Sandbox dispatch unchanged invariant");

test("serverless dispatch still posts to the same self-hosted execute route", () => {
  assert.ok(
    /\/api\/internal\/sandbox-runs\/execute/.test(DISPATCH_SRC),
    "dispatchSandboxExecution must still target /api/internal/sandbox-runs/execute"
  );
  assert.ok(
    !/repository_dispatch/.test(DISPATCH_SRC),
    "PR A must not wire up repository_dispatch — that is a follow-up PR's job"
  );
});

test("the new worker-facing claim/complete endpoints exist but are not imported by dispatch", () => {
  assert.ok(
    !/claim-exchange|sandbox-run-verification/.test(DISPATCH_SRC),
    "dispatchSandboxExecution must not yet reference the new claim/verification module"
  );
});

console.log("Sandbox dispatch unchanged invariant: all passed");
