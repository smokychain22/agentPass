import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runBaselineOnlyVerification } from "../src/lib/patch-kit/repository-verification";

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      console.error(`  ✗ ${name}`);
      throw err;
    }
  })();
}

/**
 * isWorkspaceDependencyReady (workspace-install.ts) requires >=5 entries in
 * node_modules when no specific package is declared required, so a fixture
 * with zero dependencies always fails install readiness and the phase
 * returns before ever reaching the build check — not a hang, but it looked
 * like one while debugging this file. These are tiny, zero-transitive-dep
 * packages purely to clear that bar fast.
 */
const FILLER_DEPENDENCIES = {
  "lodash.get": "^4.4.2",
  "lodash.set": "^4.3.2",
  "lodash.has": "^4.5.2",
  "lodash.omit": "^4.5.0",
  "lodash.pick": "^4.4.0",
};

async function fixture(label: string, pkg: Record<string, unknown>): Promise<string> {
  const dir = path.join(os.tmpdir(), "repodiet-test-termination", `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ dependencies: FILLER_DEPENDENCIES, ...pkg }, null, 2)
  );
  return dir;
}

function buildCheck(checks: { name: string }[]) {
  const check = checks.find((c) => c.name === "build");
  assert.ok(check, "expected a build check to exist");
  return check as { name: string; status: string; stderrSummary?: string; stdoutSummary?: string };
}

/**
 * Incident #35 follow-up: `repository-verification.ts` has its own
 * COMMAND_TIMEOUT_MS-bounded execa calls for typecheck/lint/test/build,
 * separate from workspace-install.ts's install bound and from
 * run-verification.ts (which PR #184 already fixed). It never got
 * `describeProcessTermination` wired in, so a killed build previously
 * surfaced as raw truncated stdout/stderr — read cold as a genuine compile
 * failure ("Baseline repository already fails verification") — reproduced
 * live on production against SHA 1f0f9f0. These tests exercise the REAL
 * subprocess path (not a mocked result) via runBaselineOnlyVerification.
 */
async function main() {
  console.log("repository-verification-termination");

  await test("a genuine fast build failure still surfaces its real error, unaffected by termination detection", async () => {
    const dir = await fixture("real-failure", {
      name: "fixture",
      version: "1.0.0",
      scripts: { build: 'node -e "process.stderr.write(\'a genuine compile error\\n\'); process.exit(1)"' },
    });
    const result = await runBaselineOnlyVerification({ baselineRoot: dir, cleanupRunId: "termination-test-real-failure" });
    const check = buildCheck(result.checks);
    assert.equal(check.status, "failed");
    assert.match(check.stderrSummary ?? "", /genuine compile error/);
    assert.doesNotMatch(check.stderrSummary ?? "", /exceeded its time limit/i);
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  await test("a fast, successful build passes normally, unaffected by termination detection", async () => {
    const dir = await fixture("success", {
      name: "fixture",
      version: "1.0.0",
      scripts: { build: 'node -e "console.log(\'built ok\')"' },
    });
    const result = await runBaselineOnlyVerification({ baselineRoot: dir, cleanupRunId: "termination-test-success" });
    const check = buildCheck(result.checks);
    assert.equal(check.status, "passed");
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  await test("a build killed by the command timeout is reported as killed, not as a raw truncated failure", async () => {
    const dir = await fixture("timeout", {
      name: "fixture",
      version: "1.0.0",
      scripts: {
        // Writes partial output, then hangs well past the short test timeout below.
        build: 'node -e "process.stderr.write(\'PARTIAL_OUTPUT_BEFORE_KILL\\n\'); setTimeout(()=>{}, 5000)"',
      },
    });
    const prior = process.env.REPODIET_VERIFY_COMMAND_TIMEOUT_MS;
    process.env.REPODIET_VERIFY_COMMAND_TIMEOUT_MS = "800";
    try {
      const result = await runBaselineOnlyVerification({ baselineRoot: dir, cleanupRunId: "termination-test-timeout" });
      const check = buildCheck(result.checks);
      assert.equal(check.status, "failed");
      assert.match(check.stderrSummary ?? "", /exceeded its time limit/i);
      // The whole point of the fix: a killed process's partial output must
      // never be presented as if it were the complete, real failure reason.
      assert.doesNotMatch(check.stderrSummary ?? "", /PARTIAL_OUTPUT_BEFORE_KILL/);
    } finally {
      if (prior === undefined) delete process.env.REPODIET_VERIFY_COMMAND_TIMEOUT_MS;
      else process.env.REPODIET_VERIFY_COMMAND_TIMEOUT_MS = prior;
      // Windows doesn't have real SIGTERM: the killed child's handle on its
      // own cwd can outlive execa reporting timedOut:true by a bit. CI runs
      // on ubuntu-latest, where this isn't needed; local Windows dev is.
      if (process.platform === "win32") await new Promise((r) => setTimeout(r, 1000));
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    }
  });

  await test("REPODIET_VERIFY_COMMAND_TIMEOUT_MS is consumed here, matching run-verification.ts and baseline-verification.ts", async () => {
    // A generous override should let a build that would otherwise be killed
    // at the tiny default-under-test finish normally instead.
    const dir = await fixture("override", {
      name: "fixture",
      version: "1.0.0",
      scripts: { build: 'node -e "console.log(\'built ok\')"' },
    });
    const prior = process.env.REPODIET_VERIFY_COMMAND_TIMEOUT_MS;
    process.env.REPODIET_VERIFY_COMMAND_TIMEOUT_MS = "60000";
    try {
      const result = await runBaselineOnlyVerification({ baselineRoot: dir, cleanupRunId: "termination-test-override" });
      const check = buildCheck(result.checks);
      assert.equal(check.status, "passed");
    } finally {
      if (prior === undefined) delete process.env.REPODIET_VERIFY_COMMAND_TIMEOUT_MS;
      else process.env.REPODIET_VERIFY_COMMAND_TIMEOUT_MS = prior;
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });

  console.log("repository-verification-termination: all tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
