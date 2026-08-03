import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DurableEventStore } from "../src/lib/okx-runtime/event-store";
import { runProcess } from "../src/lib/okx-runtime/process-runner";

async function run() {
  console.log("okx-runtime-process");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "RepoDiet runtime space "));
  const unicode = "RepoDiet ✓ 文件";
  const quoted = 'service="37348" value with spaces';
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
    "9636",
    "0xaa895234c3fc31c40018eef975db6ac79bf87f1a"
  );
  // Semantic-key deduplication: the same work delivered under a second event id
  // must be recognised as a duplicate and never claimed twice.
  const semanticKey = "job_created:0xjob";
  const first = store.begin({ eventId: "event-1", semanticKey, jobId: "0xjob" });
  assert.equal(first.duplicate, false);
  store.acknowledge("event-1", "cursor-1");
  const duplicate = store.begin({ eventId: "event-2", semanticKey, jobId: "0xjob" });
  assert.equal(duplicate.duplicate, true);
  assert.equal(store.read().lastCursor, "cursor-1");

  /**
   * The defective acknowledgement-only path is GONE, not merely unused.
   *
   * `provider-worker.acknowledgeProviderEvent` acknowledged an event whenever
   * `onchainos agent next-action` exited 0 — which only ever proved the CLI had
   * printed an instruction, never that anything executed it. Because
   * acknowledgement suppresses replay, every system event was permanently
   * marked done having accomplished nothing. Its replacement is
   * provider-event-executor.executeSystemEvent, reached from the real runtime
   * (scripts/repodiet-seller-runtime.ts). This asserts the old module cannot
   * come back as a second, weaker way to finish an event.
   */
  assert.equal(
    fs.existsSync("src/lib/okx-runtime/provider-worker.ts"),
    false,
    "the acknowledgement-only provider worker must not exist"
  );

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
