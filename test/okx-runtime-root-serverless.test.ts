import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { resolveRuntimeRoot } from "../src/lib/okx-runtime/runtime-root";

/**
 * Regression for a production defect caught live on 2026-08-14 verifying
 * PR A-D's GitHub Actions sandbox worker end to end: a real
 * `POST /api/github/create-cleanup-pr` call on Vercel — the operator UI's own
 * delivery path, not anything A2A/OKX-specific — failed with
 * `ENOENT: no such file or directory, mkdir '/persistent/data/okx-runtimes'`.
 *
 * Root cause: `resolveRuntimeRoot()` resolved `REPODIET_OKX_RUNTIME_ROOT`, a
 * path meaningful only on the persistent Fly.io Machine every long-lived
 * seller-runtime process shares, unconditionally — including inside
 * `createCleanupPullRequest`'s heavy-job cross-process lock
 * (heavy-job-cross-process-lock.ts), which every production delivery path
 * goes through, Vercel-originated ones included. `server/workspace.ts`
 * already had the correct pattern (branch on `isServerlessRuntime()`, fall
 * back to the ephemeral os.tmpdir()-based root) for its own, separate local
 * copy — this pins that the SHARED, exported `resolveRuntimeRoot()` now does
 * the same. `resolveRuntimeRoot()` is a pure function of `process.env` with
 * no internal caching, so re-reading env vars between assertions is enough —
 * no module re-import needed.
 */

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("okx-runtime-root serverless fallback");

const ORIGINAL_ENV = {
  VERCEL: process.env.VERCEL,
  AWS_LAMBDA_FUNCTION_NAME: process.env.AWS_LAMBDA_FUNCTION_NAME,
  REPODIET_OKX_RUNTIME_ROOT: process.env.REPODIET_OKX_RUNTIME_ROOT,
};

function restoreEnv(): void {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key as keyof typeof ORIGINAL_ENV];
    else process.env[key as keyof typeof ORIGINAL_ENV] = value;
  }
}

try {
  test("on Vercel, resolveRuntimeRoot ignores the Fly-only persistent path entirely", () => {
    process.env.VERCEL = "1";
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    process.env.REPODIET_OKX_RUNTIME_ROOT = "/persistent/data/okx-runtimes";
    const root = resolveRuntimeRoot();
    assert.equal(root.startsWith("/persistent"), false, "must never resolve into the Fly-only persistent mount on Vercel");
    assert.ok(
      root.startsWith(path.resolve(os.tmpdir())),
      `expected an os.tmpdir()-rooted path on Vercel, got ${root}`
    );
  });

  test("outside a serverless runtime, the explicit REPODIET_OKX_RUNTIME_ROOT still wins (Fly behavior unchanged)", () => {
    delete process.env.VERCEL;
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    process.env.REPODIET_OKX_RUNTIME_ROOT = "/persistent/data/okx-runtimes";
    const root = resolveRuntimeRoot();
    assert.equal(root, path.resolve("/persistent/data/okx-runtimes"));
  });

  test("AWS_LAMBDA_FUNCTION_NAME is also treated as serverless, same as VERCEL", () => {
    delete process.env.VERCEL;
    process.env.AWS_LAMBDA_FUNCTION_NAME = "some-function";
    process.env.REPODIET_OKX_RUNTIME_ROOT = "/persistent/data/okx-runtimes";
    const root = resolveRuntimeRoot();
    assert.equal(root.startsWith("/persistent"), false);
  });

  test("without the env var configured at all, serverless and non-serverless both resolve to a writable, absolute path", () => {
    delete process.env.REPODIET_OKX_RUNTIME_ROOT;
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;

    process.env.VERCEL = "1";
    const serverless = resolveRuntimeRoot();
    assert.ok(path.isAbsolute(serverless));

    delete process.env.VERCEL;
    const local = resolveRuntimeRoot();
    assert.ok(path.isAbsolute(local));
  });
} finally {
  restoreEnv();
}

console.log("okx-runtime-root serverless fallback: all passed");
