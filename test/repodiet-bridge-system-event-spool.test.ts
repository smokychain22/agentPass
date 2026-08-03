/**
 * The bridge must hand official system events to the seller runtime, and must
 * never answer one itself.
 *
 * Before this, a system envelope did not match the seller session-key pattern,
 * so decideReply returned undefined and OpenClaw fell through to the model —
 * the stock `openai/gpt-5.5`, which does not exist in this deployment. The run
 * died `state=error` and the official lifecycle silently never advanced. Buyer
 * chat must be completely unaffected by the fix.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { decideReply } from "../openclaw-plugins/repodiet-a2a-bridge/logic.js";
import {
  parseOfficialSystemEnvelope,
  systemEventInboxDirectory,
} from "../openclaw-plugins/repodiet-a2a-bridge/system-event-spool.js";
import { validateOfficialEnvelope } from "../src/lib/okx-runtime/system-event-intake";

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

const JOB = "0x38463285397e0844c7c01446bae2783ea3a8b00f45147768c31d97cb484ce8a6";
const SYSTEM_ENVELOPE = {
  agentId: "9636",
  message: { source: "system", event: "job_accepted", jobId: JOB },
};

function inbox(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "repodiet-bridge-spool-"));
  return directory;
}

/** Fails loudly if anything tries to dispatch or publish for a system event. */
const forbidden = {
  dispatchAnalyzeRepository: () => {
    throw new Error("a system event must never reach A2MCP dispatch");
  },
  dispatchCreateTask: () => {
    throw new Error("a system event must never reach A2A task intake");
  },
  publishReply: () => {
    throw new Error("a system event must never produce a bridge reply");
  },
  log: () => {},
};

async function run() {
  console.log("repodiet-bridge-system-event-spool");

  await test("an official system envelope is recognised structurally", () => {
    const parsed = parseOfficialSystemEnvelope(JSON.stringify(SYSTEM_ENVELOPE));
    assert.deepEqual(parsed, SYSTEM_ENVELOPE);
  });

  await test("anything not provably an official system event is left alone", () => {
    for (const body of [
      undefined,
      "",
      "please clean up https://github.com/velz-cmd/repodiet-e2e-test",
      "{ not json",
      JSON.stringify({ msgType: "a2a-agent-chat", message: { source: "system", jobId: JOB } }),
      JSON.stringify({ agentId: "9636", message: { source: "user", event: "x", jobId: JOB } }),
      // Addressed to another agent — never claimed as ours.
      JSON.stringify({ agentId: "8178", message: { source: "system", event: "x", jobId: JOB } }),
      // No addressee at all.
      JSON.stringify({ message: { source: "system", event: "x", jobId: JOB } }),
      // Malformed job id.
      JSON.stringify({ agentId: "9636", message: { source: "system", event: "x", jobId: "0x1" } }),
    ]) {
      assert.equal(parseOfficialSystemEnvelope(body), undefined, `must not claim: ${String(body)}`);
    }
  });

  await test("an oversized body is refused before it is parsed as an envelope", () => {
    const huge = JSON.stringify({
      agentId: "9636",
      message: { source: "system", event: "x", jobId: JOB, padding: "x".repeat(40_000) },
    });
    assert.equal(parseOfficialSystemEnvelope(huge), undefined);
  });

  await test("a system event is claimed, spooled, and never answered by the bridge", async () => {
    const directory = inbox();
    const result = await decideReply(
      { cleanedBody: JSON.stringify(SYSTEM_ENVELOPE) },
      { sessionKey: "system-notification", messageId: "msg-1" },
      { ...forbidden, systemEventInbox: directory }
    );

    assert.equal(result?.handled, true, "must claim the turn so it cannot reach the model");
    assert.equal(result?.reply, undefined, "silence — the runtime publishes the real status");
    assert.equal(result?.reason, "repodiet_system_event_spooled");

    const files = fs.readdirSync(directory);
    assert.deepEqual(files, ["msg-1.json"], "keyed on transport identity, so a redelivery collapses");
    const spooled = JSON.parse(fs.readFileSync(path.join(directory, files[0]), "utf8"));
    assert.deepEqual(spooled, SYSTEM_ENVELOPE);
  });

  await test("what the bridge spools is exactly what the runtime will accept", () => {
    const directory = inbox();
    const parsed = parseOfficialSystemEnvelope(JSON.stringify(SYSTEM_ENVELOPE));
    // The bridge is a transport shim; the runtime re-validates from scratch.
    // These two must agree, or events would be spooled and then never run.
    const verdict = validateOfficialEnvelope(parsed);
    assert.equal(verdict.ok, true);
    assert.equal(fs.readdirSync(directory).length, 0);
  });

  await test("a redelivery of the same transport message spools exactly once", async () => {
    const directory = inbox();
    const deps = { ...forbidden, systemEventInbox: directory };
    const ctx = { sessionKey: "system-notification", messageId: "msg-1" };
    await decideReply({ cleanedBody: JSON.stringify(SYSTEM_ENVELOPE) }, ctx, deps);
    await decideReply({ cleanedBody: JSON.stringify(SYSTEM_ENVELOPE) }, ctx, deps);
    assert.deepEqual(fs.readdirSync(directory), ["msg-1.json"]);
  });

  await test("a spool failure still claims the turn rather than falling through to a model", async () => {
    const result = await decideReply(
      { cleanedBody: JSON.stringify(SYSTEM_ENVELOPE) },
      { sessionKey: "system-notification" },
      {
        ...forbidden,
        spoolSystemEvent: () => {
          throw new Error("disk full");
        },
      }
    );
    assert.equal(result?.handled, true);
    assert.equal(result?.reply, undefined);
  });

  await test("ordinary buyer chat still takes the deterministic path unchanged", async () => {
    let dispatched = 0;
    const result = await decideReply(
      { cleanedBody: "Please clean up https://github.com/velz-cmd/repodiet-e2e-test" },
      { sessionKey: `job:${JOB}:my:9636:to:5295` },
      {
        log: () => {},
        dispatchCreateTask: async () => {
          dispatched += 1;
          return { status: 200, body: { message: "SCOPE_REQUIRED" } };
        },
        publishReply: async () => ({ ok: true, messageId: "xmtp-1" }),
        getPublication: () => undefined,
        recordPublication: () => {},
        getRecordedDispatch: () => undefined,
        recordDispatch: () => {},
      }
    );

    assert.equal(dispatched, 1, "buyer chat must still reach the real deterministic pipeline");
    assert.equal(result?.handled, true);
    assert.match(String(result?.reason), /^repodiet_a2a_dispatch_status_/);
  });

  await test("the spool directory is derived from the runtime's own volume layout", () => {
    const directory = systemEventInboxDirectory({
      NODE_ENV: "test",
      REPODIET_OKX_RUNTIME_ROOT: "/persistent/data/okx-runtimes",
    } satisfies NodeJS.ProcessEnv);
    assert.equal(
      directory.split(path.sep).join("/"),
      "/persistent/data/okx-runtimes/seller-9636/data/system-events/inbox"
    );
  });

  console.log("repodiet-bridge-system-event-spool: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
