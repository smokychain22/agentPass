import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DurableEventStore } from "../src/lib/okx-runtime/event-store";
import { acknowledgeProviderEvent } from "../src/lib/okx-runtime/provider-worker";
import { runProcess } from "../src/lib/okx-runtime/process-runner";

async function run() {
  console.log("okx-runtime-process");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "RepoDiet runtime space "));
  const unicode = "RepoDiet ✓ 文件";
  const quoted = 'service="32947" value with spaces';
  const success = await runProcess(
    process.execPath,
    ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", unicode, quoted],
    { cwd: root }
  );
  assert.equal(success.ok, true);
  assert.deepEqual(JSON.parse(success.stdout), [unicode, quoted]);

  const missing = await runProcess(path.join(root, "missing executable.exe"), []);
  assert.equal(missing.ok, false);
  assert.match(missing.stderr, /ENOENT|not found/i);

  const timeout = await runProcess(process.execPath, ["-e", "setTimeout(()=>{}, 10000)"], {
    timeoutMs: 30,
  });
  assert.equal(timeout.timedOut, true);

  const controller = new AbortController();
  const cancelledPromise = runProcess(process.execPath, ["-e", "setTimeout(()=>{}, 10000)"], {
    signal: controller.signal,
    timeoutMs: 10_000,
  });
  controller.abort();
  const cancelled = await cancelledPromise;
  assert.equal(cancelled.cancelled, true);

  const eventFile = path.join(root, "seller", "events.json");
  const store = new DurableEventStore(
    eventFile,
    "5283",
    "0x1339724ada3adf04bb7a8ccc6498216214bbdf90"
  );
  let calls = 0;
  const event = {
    eventId: "event-1",
    event: "job_created",
    jobId: "0xjob",
    cursor: "cursor-1",
    payload: { title: unicode, serviceId: "32947" },
  };
  const first = await acknowledgeProviderEvent(event, {
    executable: "onchainos",
    agentId: "5283",
    store,
    runner: async (_exe, args) => {
      calls += 1;
      assert.deepEqual(args.slice(0, 6), [
        "agent",
        "next-action",
        "--role",
        "asp",
        "--agentId",
        "5283",
      ]);
      assert.equal(args[6], "--message");
      assert.equal(JSON.parse(args[7]).serviceId, "32947");
      return {
        ok: true,
        exitCode: 0,
        signal: null,
        stdout: "application acknowledged",
        stderr: "",
        timedOut: false,
        cancelled: false,
      };
    },
  });
  assert.equal(first.ok, true);
  assert.ok(first.latencyMs < 10_000);

  const duplicate = await acknowledgeProviderEvent(
    { ...event, eventId: "event-2" },
    {
      executable: "onchainos",
      agentId: "5283",
      store,
      runner: async () => {
        throw new Error("duplicate must not execute");
      },
    }
  );
  assert.equal(duplicate.duplicate, true);
  assert.equal(calls, 1);
  assert.equal(store.read().lastCursor, "cursor-1");

  assert.doesNotMatch(
    fs.readFileSync("src/lib/okx-runtime/process-runner.ts", "utf8"),
    /ArgumentList|python|py\.exe/
  );
  console.log("okx-runtime-process: all passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
