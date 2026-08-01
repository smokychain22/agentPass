/**
 * src/lib/okx-runtime/runtime-layout.ts's readLivePid/writePid — the
 * single-instance PID lock.
 *
 * === Incident #10 ===
 * Live on repodiet-agent-9636: a container reboot resets the kernel's PID
 * counter, so early-boot PIDs are drawn from a small, low, largely
 * deterministic range every time. A fresh boot's `openclaw-gateway` child
 * happened to land on the exact same PID a PREVIOUS boot's seller-runtime
 * had recorded in this persisted lock file. `process.kill(pid, 0)` alone
 * cannot distinguish "the same process, still running" from "a different
 * process that coincidentally reused this PID number" — it only proves a
 * process with that PID currently exists. The false positive
 * ("another_seller_runtime_is_already_live") made every subsequent boot
 * attempt refuse to start, exhausting the Machine's full restart budget.
 *
 * Fix: pair the PID with the OS's own process start time
 * (/proc/<pid>/stat field 22) at write time, and re-verify both match at
 * read time — the same technique real process supervisors use to guard
 * against PID reuse. These tests exercise the real functions against the
 * real filesystem and (where available) the real /proc of this process's
 * own PID — not a mock.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getRuntimePaths, ensureRuntimeLayout, readLivePid, writePid } from "../src/lib/okx-runtime/runtime-layout";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

function freshPidFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-layout-pid-lock-test-"));
  const paths = getRuntimePaths(dir, "seller");
  ensureRuntimeLayout(paths);
  return paths.pidFile;
}

const HAS_PROC = fs.existsSync(`/proc/${process.pid}/stat`);

function run() {
  console.log("runtime-layout-pid-lock");

  test("writePid + readLivePid round-trips our own genuinely-live PID", () => {
    const pidFile = freshPidFile();
    writePid(pidFile, process.pid);
    assert.equal(readLivePid(pidFile), process.pid);
  });

  test("a legacy plain-PID lock file (written before this fix, no recorded start time) still works via the liveness check alone", () => {
    const pidFile = freshPidFile();
    fs.writeFileSync(pidFile, `${process.pid}\n`, "utf8");
    assert.equal(readLivePid(pidFile), process.pid, "backward compatible with the pre-fix plain-integer format");
  });

  test("a PID that cannot exist is treated as a stale lock and self-clears, regardless of format", () => {
    const pidFile = freshPidFile();
    fs.writeFileSync(pidFile, "2147483646\n", "utf8");
    assert.equal(readLivePid(pidFile), undefined);
    assert.equal(fs.existsSync(pidFile), false, "the stale lock file must be removed, not merely ignored");
  });

  test("Incident #10 regression: a lock recorded against our own live PID but with a WRONG start time (simulating a PID reused across a reboot) is treated as stale, not trusted", () => {
    const pidFile = freshPidFile();
    fs.writeFileSync(pidFile, JSON.stringify({ pid: process.pid, startTime: "999999999999999" }), "utf8");
    const result = readLivePid(pidFile);
    if (HAS_PROC) {
      assert.equal(result, undefined, "a start-time mismatch must invalidate the lock when /proc is available to prove it — this is the exact false positive that caused the real incident");
      assert.equal(fs.existsSync(pidFile), false);
    } else {
      // Non-Linux development environment: /proc is unavailable, so this
      // stronger check cannot run and behavior intentionally degrades to
      // the plain liveness check alone (never a regression from prior
      // behavior). Documents the platform limitation rather than silently
      // skipping the assertion.
      assert.equal(result, process.pid, "without /proc, the start-time check cannot run — this branch documents that platform limitation");
    }
  });

  test("an unparseable lock file (neither a bare integer nor valid JSON) is treated as stale and self-clears", () => {
    const pidFile = freshPidFile();
    fs.writeFileSync(pidFile, "not-a-pid-and-not-json{{{", "utf8");
    assert.equal(readLivePid(pidFile), undefined);
    assert.equal(fs.existsSync(pidFile), false);
  });

  test("a JSON lock file missing a numeric pid field is treated as stale and self-clears", () => {
    const pidFile = freshPidFile();
    fs.writeFileSync(pidFile, JSON.stringify({ startTime: "123" }), "utf8");
    assert.equal(readLivePid(pidFile), undefined);
    assert.equal(fs.existsSync(pidFile), false);
  });

  test("writePid captures a real start time when /proc is available, so the stronger check is actually exercised in production (Linux)", () => {
    const pidFile = freshPidFile();
    writePid(pidFile, process.pid);
    const raw = fs.readFileSync(pidFile, "utf8");
    const parsed = JSON.parse(raw);
    assert.equal(parsed.pid, process.pid);
    if (HAS_PROC) {
      assert.equal(typeof parsed.startTime, "string");
      assert.ok(parsed.startTime.length > 0);
    }
  });

  console.log("runtime-layout-pid-lock: all passed");
}

run();
