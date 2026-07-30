/**
 * Regression tests for scripts/seller-production-readiness.ts — the
 * pre-resubmission production-readiness gate. Source-based, same style as
 * test/seller-runtime-portability.test.ts: this script's real behavior
 * (live CLI/HTTP probes) can only be fully exercised against a live
 * container, so these tests pin the aggregation/fail-closed contract and
 * secret hygiene instead of mocking every external call.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

const REPO_ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "seller-production-readiness.ts");

function source(): string {
  return fs.readFileSync(SCRIPT, "utf8");
}

function run() {
  console.log("seller-production-readiness");

  test("exits non-zero (via process.exitCode) unless every required check is ready — never process.exit() mid-flight", () => {
    const src = source();
    assert.ok(
      src.includes("process.exitCode = report.ready ? 0 : 1"),
      "readiness must gate the exit code on the aggregated report, not a partial check"
    );
    // process.exit() immediately after several sequential child_process
    // spawns has been observed to crash on Windows (libuv assertion) —
    // process.exitCode lets Node drain pending handles naturally instead.
    const codeLines = src.split("\n").filter((line) => !line.trim().startsWith("//"));
    assert.ok(
      !codeLines.some((line) => /\bprocess\.exit\(/.test(line)),
      "must use process.exitCode, not process.exit(), after the probes run"
    );
  });

  test("a single failing required check fails the whole gate", () => {
    const src = source();
    assert.ok(
      src.includes("checks.filter((c) => c.requiredForProduction && !c.ready)"),
      "readiness must be the logical AND of every required check, not a majority or best-effort count"
    );
  });

  test("covers every condition listed in the task spec", () => {
    const src = source();
    for (const id of [
      "onchainos_wallet_logged_in",
      "agent_9636_selected",
      "communication_address_correct",
      "openclaw_gateway_authenticated",
      "okx_a2a_provider_configured",
      "a2a_daemon_running",
      "xmtp_communication_active",
      "onchainos_ready",
      "vercel_heartbeat_accepted",
      "task_dispatcher_registered",
      "github_app_installation_token_works",
      "github_app_can_access_e2e_repo",
      "only_one_seller_runtime_active",
    ]) {
      assert.ok(src.includes(`"${id}"`), `missing required check: ${id}`);
    }
  });

  test("the GitHub App check is scoped to the controlled E2E repository, not a generic probe", () => {
    const src = source();
    assert.ok(src.includes('owner: "velz-cmd"') && src.includes('repo: "repodiet-e2e-test"'));
  });

  test("single-instance check proves a live PID, not merely that a lock file exists", () => {
    const src = source();
    assert.ok(src.includes("readLivePid(paths.pidFile)"), "must use the live-PID probe, not fs.existsSync alone");
    assert.ok(!/existsSync\(paths\.pidFile\)/.test(src), "must not treat file existence alone as proof of a live runtime");
  });

  test("every probe defaults to ready:false on error — a failed call never reports the check as passing", () => {
    const src = source();
    const catchBlocks = src.match(/catch[\s\S]{0,200}?record\(/g) ?? [];
    assert.ok(catchBlocks.length >= 4, "sanity check: several probes should have catch-to-record paths");
    for (const block of catchBlocks) {
      assert.ok(!/record\([^)]*,\s*true\s*,/.test(block), `a catch block must not record ready:true: ${block}`);
    }
  });

  test("no secret values are ever logged — only booleans, counts, and diagnostic strings", () => {
    const src = source();
    assert.ok(!/OPENCLAW_GATEWAY_TOKEN\s*[:=]\s*["'`][^"'`]+["'`]/.test(src));
    assert.ok(!/HEARTBEAT_SECRET\s*[:=]\s*["'`][^"'`]+["'`]/.test(src));
    // The resolved GitHub App installation token is only ever passed to
    // Boolean(...) — never string-interpolated into a printed detail.
    assert.ok(!/\$\{token\}/.test(src), "the token value must never be interpolated into a printed string");
    assert.ok(src.includes("Boolean(token)"), "the token must only be used for a boolean truthiness check");
  });

  console.log("seller-production-readiness: all passed");
}

run();
