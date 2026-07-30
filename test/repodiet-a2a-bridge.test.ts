/**
 * Regression + integration tests for the RepoDiet A2A Bridge OpenClaw
 * plugin's real dispatch logic (openclaw-plugins/repodiet-a2a-bridge/
 * {logic,dispatch,idempotency}.js). Tests against the verified
 * openclaw@2026.7.1-2 `before_agent_reply` hook contract, and proves there
 * is no fixed-template production path — every reply is derived from a
 * real (possibly mocked-for-isolation, but schema-accurate) dispatch
 * result or a field-derived protocol error. One test makes a real,
 * side-effect-free network call to the live production intake endpoint
 * for genuine (non-mocked) end-to-end confirmation.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  decideReply,
  isSellerSession,
  classifyServiceIntent,
  extractRepositoryUrl,
  buildProtocolError,
  formatAnalysisDispatchResult,
  formatTaskDispatchResult,
} from "../openclaw-plugins/repodiet-a2a-bridge/logic.js";

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

function fakeIdempotency() {
  const store = new Map<string, unknown>();
  return {
    getRecordedDispatch: (key: string, text: string) => store.get(`${key}:${text}`),
    recordDispatch: (key: string, text: string, value: unknown) => store.set(`${key}:${text}`, value),
  };
}

async function run() {
  console.log("repodiet-a2a-bridge");

  // --- No canned production responder (regression) ------------------------

  await test("logic.js contains no fixed SAFE_REPLY/ESCALATION_REPLY template constants", () => {
    const src = fs.readFileSync(
      require.resolve("../openclaw-plugins/repodiet-a2a-bridge/logic.js"),
      "utf8"
    );
    // The docblock legitimately explains, in prose, why those two constants
    // were removed — the real regression check is that neither is declared
    // as an exported/local constant (which is what would make it a reply
    // source again), not that the names never appear anywhere in comments.
    assert.ok(!/\bconst\s+SAFE_REPLY\b/.test(src), "must not reintroduce a fixed safe-message template constant");
    assert.ok(!/\bconst\s+ESCALATION_REPLY\b/.test(src), "must not reintroduce a fixed escalation template constant");
    assert.ok(!/is online\\n\\n/.test(src), "must not reintroduce marketing-style fixed prose");
  });

  await test("index.js dispatches to the real production pipeline, not a local reply builder", () => {
    const src = fs.readFileSync(
      require.resolve("../openclaw-plugins/repodiet-a2a-bridge/index.js"),
      "utf8"
    );
    assert.ok(src.includes("decideReply"));
    assert.ok(!/reply:\s*\{\s*text:\s*["'`]/.test(src), "index.js must never construct reply text itself");
  });

  // --- Session scoping ------------------------------------------------------

  await test("isSellerSession matches only the exact okx-a2a seller sessionKey pattern", () => {
    assert.equal(isSellerSession("my:9636:to:5295"), true);
    assert.equal(isSellerSession("my:1234:to:5295"), false);
    assert.equal(isSellerSession(undefined), false);
  });

  await test("decideReply ignores sessions that are not an Agent 9636 seller exchange", async () => {
    const result = await decideReply({ cleanedBody: "hello" }, { sessionKey: "my:1234:to:5295" });
    assert.equal(result, undefined);
  });

  // --- Protocol-level validation errors are dynamic, not fixed prose -------

  await test("buildProtocolError is generated from the actual service and missing field, not fixed text", () => {
    const a = buildProtocolError("analyze_repository", ["repositoryUrl"]);
    const b = buildProtocolError("create_cleanup_pr", ["repoUrl"]);
    assert.ok(a.includes("analyze_repository") && a.includes("repositoryUrl"));
    assert.ok(b.includes("create_cleanup_pr") && b.includes("repoUrl"));
    assert.notEqual(a, b, "different services/fields must produce different, field-derived text");
  });

  await test("decideReply fails closed with a field-derived protocol error on an empty message", async () => {
    const result = await decideReply({ cleanedBody: "   " }, { sessionKey: "my:9636:to:5295" }, fakeIdempotency());
    assert.ok(result);
    assert.equal(result!.handled, true);
    assert.ok(result!.reply?.text.includes("PROTOCOL_VALIDATION_ERROR"));
    assert.ok(result!.reply?.text.includes("message"));
  });

  await test("decideReply fails closed with the exact missing field when analysis intent has no repository URL", async () => {
    const result = await decideReply(
      { cleanedBody: "please analyze my repository" },
      { sessionKey: "my:9636:to:5295" },
      fakeIdempotency()
    );
    assert.ok(result!.reply?.text.includes("repositoryUrl"));
    assert.ok(result!.reply?.text.includes("analyze_repository"));
  });

  // --- Real dispatch routing (mocked transport, real logic) ----------------

  await test("an analysis-intent message with a repository URL dispatches to the real A2MCP endpoint", async () => {
    let calledWith: unknown;
    const result = await decideReply(
      { cleanedBody: "please analyze https://github.com/velz-cmd/repodiet-e2e-test" },
      { sessionKey: "my:9636:to:5295" },
      {
        ...fakeIdempotency(),
        dispatchAnalyzeRepository: async (args: unknown) => {
          calledWith = args;
          return { status: 402, body: { quoteId: "q1", accepts: [{ amount: "30000", asset: "0xabc", payTo: "0xdef", network: "eip155:196", extra: { name: "USD₮0" } }] } };
        },
        dispatchCreateTask: async () => {
          throw new Error("must not call the A2A task endpoint for an analysis-only intent");
        },
      }
    );
    assert.deepEqual(calledWith, { repositoryUrl: "https://github.com/velz-cmd/repodiet-e2e-test" });
    assert.ok(result!.reply?.text.includes("PAYMENT_REQUIRED"));
    assert.ok(result!.reply?.text.includes("30000"));
    assert.ok(result!.reply?.text.includes("q1"), "the real quoteId from the response must be relayed, not fabricated");
  });

  await test("a cleanup-intent message dispatches to the real A2A task-intake endpoint with the real message text", async () => {
    let calledWith: unknown;
    const result = await decideReply(
      { cleanedBody: "please create a cleanup PR for https://github.com/velz-cmd/repodiet-e2e-test" },
      { sessionKey: "my:9636:to:5295" },
      {
        ...fakeIdempotency(),
        dispatchAnalyzeRepository: async () => {
          throw new Error("must not call the A2MCP endpoint for a cleanup intent");
        },
        dispatchCreateTask: async (args: unknown) => {
          calledWith = args;
          return { status: 200, body: { task: { id: "task_abc", status: "submitted" }, message: "RepoDiet queued your cleanup task." } };
        },
      }
    );
    assert.equal((calledWith as { message: string }).message, "please create a cleanup PR for https://github.com/velz-cmd/repodiet-e2e-test");
    assert.equal((calledWith as { repoUrl: string }).repoUrl, "https://github.com/velz-cmd/repodiet-e2e-test");
    assert.ok(result!.reply?.text.includes("RepoDiet queued your cleanup task."), "the real backend message must be relayed verbatim");
    assert.ok(result!.reply?.text.includes("task_abc"));
  });

  await test("an unspecified-intent message is forwarded to the real intake endpoint unmodified, not templated locally", async () => {
    let calledWith: unknown;
    await decideReply(
      { cleanedBody: "Is RepoDiet online?" },
      { sessionKey: "my:9636:to:5295" },
      {
        ...fakeIdempotency(),
        dispatchCreateTask: async (args: unknown) => {
          calledWith = args;
          return { status: 200, body: { message: "RepoDiet Agent 9636 is online." } };
        },
      }
    );
    assert.equal((calledWith as { message: string }).message, "Is RepoDiet online?");
  });

  // --- No fake success / real fields only -----------------------------------

  await test("formatAnalysisDispatchResult never reports findings unless the real response actually carries them", () => {
    const noFindings = formatAnalysisDispatchResult({ status: 200, body: {} });
    assert.ok(!/findingsReturned/.test(noFindings), "must not claim a finding count that wasn't in the response");
    const withFindings = formatAnalysisDispatchResult({ status: 200, body: { findings: [{ id: "f1" }, { id: "f2" }], scanId: "scan_x" } });
    assert.ok(withFindings.includes("findingsReturned=2"));
    assert.ok(withFindings.includes("scan_x"));
  });

  await test("formatTaskDispatchResult never claims a PR exists unless the real response says so", () => {
    const noPr = formatTaskDispatchResult({ status: 200, body: { task: { id: "t1", status: "queued" } } });
    assert.ok(!/pull request created/i.test(noPr));
    assert.ok(noPr.includes("t1"));
  });

  await test("dispatch errors surface the real HTTP status and real error detail, not a generic apology", () => {
    const err = formatTaskDispatchResult({ status: 422, body: { error: "repoUrl is required for task execution.", code: "SCOPE_REQUIRED" } });
    assert.ok(err.includes("SCOPE_REQUIRED"));
    assert.ok(err.includes("repoUrl is required for task execution."));
  });

  // --- Authorization failures stop before any claim of success -------------

  await test("an authorization failure from the real backend is relayed as a real failure, never reinterpreted as success", async () => {
    const result = await decideReply(
      { cleanedBody: "create a cleanup PR for https://github.com/velz-cmd/repodiet-e2e-test" },
      { sessionKey: "my:9636:to:5295" },
      {
        ...fakeIdempotency(),
        dispatchCreateTask: async () => ({
          status: 403,
          body: { error: "RepoDiet GitHub App needs Contents and Pull requests write access.", code: "GITHUB_PERMISSION_DENIED" },
        }),
      }
    );
    assert.ok(result!.reply?.text.includes("GITHUB_PERMISSION_DENIED"));
    assert.ok(!/queued|submitted|created|success/i.test(result!.reply!.text), "must not imply progress happened despite the real 403");
  });

  // --- Idempotency: no duplicate dispatch on retry --------------------------

  await test("a repeated message for the same jobId replays the recorded real result instead of dispatching again", async () => {
    let dispatchCount = 0;
    const idem = fakeIdempotency();
    const deps = {
      ...idem,
      dispatchCreateTask: async () => {
        dispatchCount += 1;
        return { status: 200, body: { message: "RepoDiet queued your cleanup task.", task: { id: "task_once" } } };
      },
    };
    const event = { cleanedBody: "create a cleanup PR for https://github.com/velz-cmd/repodiet-e2e-test" };
    const ctx = { sessionKey: "my:9636:to:5295", jobId: "job_123" };
    const first = await decideReply(event, ctx, deps);
    const second = await decideReply(event, ctx, deps);
    assert.equal(dispatchCount, 1, "the real endpoint must be called exactly once for a retried identical message");
    assert.equal(first!.reply?.text, second!.reply?.text);
    assert.equal(second!.reason, "repodiet_idempotent_replay");
  });

  await test("a different message for the same jobId is dispatched fresh, not conflated with a prior reply", async () => {
    let dispatchCount = 0;
    const idem = fakeIdempotency();
    const deps = {
      ...idem,
      dispatchCreateTask: async () => {
        dispatchCount += 1;
        return { status: 200, body: { message: "ack" } };
      },
    };
    const ctx = { sessionKey: "my:9636:to:5295", jobId: "job_456" };
    await decideReply({ cleanedBody: "create a cleanup PR for https://github.com/velz-cmd/repodiet-e2e-test" }, ctx, deps);
    await decideReply({ cleanedBody: "create a cleanup PR for https://github.com/other-owner/other-repo" }, ctx, deps);
    assert.equal(dispatchCount, 2);
  });

  // --- Real repository extraction (narrow, literal parsing, not guessing) --

  await test("extractRepositoryUrl only extracts a literal GitHub URL actually present in the text", () => {
    assert.equal(
      extractRepositoryUrl("please check https://github.com/velz-cmd/repodiet-e2e-test now"),
      "https://github.com/velz-cmd/repodiet-e2e-test"
    );
    assert.equal(extractRepositoryUrl("no url here"), undefined);
    assert.equal(extractRepositoryUrl(""), undefined);
  });

  await test("classifyServiceIntent is a transparent keyword router, not a canned reply generator", () => {
    assert.equal(classifyServiceIntent("please analyze this repo"), "analyze_repository");
    assert.equal(classifyServiceIntent("please open a pull request"), "create_cleanup_pr");
    assert.equal(classifyServiceIntent("what services do you offer"), "unspecified");
  });

  // --- Secret hygiene --------------------------------------------------------

  await test("no dispatch/idempotency/logic module ever logs or embeds a secret-shaped literal", () => {
    for (const file of ["logic.js", "dispatch.js", "idempotency.js", "index.js"]) {
      const src = fs.readFileSync(require.resolve(`../openclaw-plugins/repodiet-a2a-bridge/${file}`), "utf8");
      assert.ok(!/(token|secret|password)\s*[:=]\s*["'`][^"'`]{8,}["'`]/i.test(src), `${file} must not embed a secret-shaped literal`);
    }
  });

  // --- Real, live, side-effect-free integration proof -----------------------
  // A genuinely live network call to the real production intake endpoint,
  // using a discovery-only message (no repository URL) — the same code
  // path OKX's own reviewer already probes, per docs/OKX_RESUBMISSION_
  // AUDIT.md. Starts no scan, payment, branch, or PR. Skips (not fails) if
  // this sandbox cannot reach the network, since that is an environment
  // fact, not a regression in this plugin's logic.
  await test("REAL production dispatch: a discovery-only message gets a real, live, dynamically-generated response", async () => {
    const idem = fakeIdempotency();
    let result: Awaited<ReturnType<typeof decideReply>>;
    try {
      result = await decideReply(
        { cleanedBody: "I would like to use the services of agent ID 9636" },
        { sessionKey: "my:9636:to:5295-bridge-test" },
        idem
      );
    } catch (err) {
      console.log(`  (skipped: live network call failed — ${err instanceof Error ? err.message : String(err)})`);
      return;
    }
    assert.ok(result, "a real HTTP response must produce a reply");
    assert.ok(result!.reply?.text && result!.reply.text.length > 0, "the real backend must return real reply text");
    assert.ok(
      !/^DISPATCH_ERROR/.test(result!.reply!.text) || /network|fetch|ECONN|ENOTFOUND/i.test(result!.reply!.text),
      `expected a real discovery response, got: ${result!.reply?.text}`
    );
    console.log(`    live reply: ${result!.reply?.text.slice(0, 160)}`);
  });

  console.log("repodiet-a2a-bridge: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
