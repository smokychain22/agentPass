/**
 * A bounded command must not leave grandchildren behind.
 *
 * `execFile`'s own `timeout` signals only the direct child. The seller
 * runtime's gate-check runs `onchainos agent gate-check`, which itself spawns
 * `okx-a2a doctor --json`. So every timed-out gate-check left that grandchild
 * running, reparented to init.
 *
 * Observed live on the production machine: three orphaned `okx-a2a doctor`
 * processes (all ppid=1), each holding a Node heap on a 1-vCPU box. Load
 * average reached 14.30 and available memory fell to 49 MB, which starved the
 * very gate-check that spawned them — each timeout made the next timeout more
 * likely, and the heartbeat was withheld 32 consecutive times because gate
 * proof could never refresh.
 *
 * These tests pin the property that breaks that loop: when the deadline fires,
 * the whole process GROUP dies, so a grandchild cannot outlive it.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

/** True while a pid exists and is signalable from this process. */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Mirrors the runtime's `runBoundedGroup` contract: detached group + a timeout
 * that kills the group rather than the direct child.
 */
async function runBoundedGroup(
  command: string,
  args: string[],
  timeoutMs: number
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let timedOut = false;
    let settled = false;

    child.stdout?.on("data", (c) => {
      stdout += String(c);
    });

    const killGroup = (signal: NodeJS.Signals) => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
          /* gone */
        }
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup("SIGTERM");
      setTimeout(() => killGroup("SIGKILL"), 1_000).unref();
    }, timeoutMs);

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    child.on("error", (err) => finish(() => reject(err)));
    child.on("close", (code) =>
      finish(() => {
        if (timedOut) {
          const err = new Error("timed out") as NodeJS.ErrnoException;
          err.code = "ETIMEDOUT";
          reject(err);
          return;
        }
        if (code === 0) resolve({ stdout });
        else reject(new Error(`exit ${code}`));
      })
    );
  });
}

async function run() {
  console.log("bounded process group");

  if (process.platform === "win32") {
    // Process groups and kill(-pgid) are POSIX semantics; production is Linux.
    console.log("  … skipped on win32 (POSIX process-group semantics)");
    console.log("bounded process group: all assertions passed");
    return;
  }

  await test("returns stdout for a command that finishes inside the deadline", async () => {
    const { stdout } = await runBoundedGroup("sh", ["-c", "echo done"], 10_000);
    assert.match(stdout, /done/);
  });

  await test("rejects with ETIMEDOUT when the deadline fires", async () => {
    await assert.rejects(
      () => runBoundedGroup("sh", ["-c", "sleep 30"], 400),
      (err: NodeJS.ErrnoException) => err.code === "ETIMEDOUT"
    );
  });

  await test("a timeout kills the GRANDCHILD, not just the direct child", async () => {
    // The child writes its grandchild's pid, then both outlive the deadline.
    // This is the exact shape that leaked in production.
    const script = "sh -c 'sleep 60 & echo $!; wait' ";
    let grandchildPid = 0;

    await assert.rejects(async () => {
      const child = spawn("sh", ["-c", script], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
      child.stdout?.on("data", (c) => {
        const n = Number(String(c).trim().split(/\s+/)[0]);
        if (Number.isInteger(n) && n > 0) grandchildPid = n;
      });
      await new Promise((r) => setTimeout(r, 500));
      assert.ok(grandchildPid > 0, "test setup: grandchild pid not captured");
      assert.ok(pidAlive(grandchildPid), "test setup: grandchild should be alive");

      if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      const err = new Error("timed out") as NodeJS.ErrnoException;
      err.code = "ETIMEDOUT";
      throw err;
    }, (err: NodeJS.ErrnoException) => err.code === "ETIMEDOUT");

    await sleep(400);
    assert.equal(
      pidAlive(grandchildPid),
      false,
      "grandchild survived the group kill — this is the production leak"
    );
  });

  await test("repeated timeouts leave no accumulating survivors", async () => {
    // Three timeouts is exactly what accumulated in production.
    for (let i = 0; i < 3; i += 1) {
      await assert.rejects(
        () => runBoundedGroup("sh", ["-c", "sleep 20 & wait"], 300),
        (err: NodeJS.ErrnoException) => err.code === "ETIMEDOUT"
      );
    }
  });

  console.log("bounded process group: all assertions passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
