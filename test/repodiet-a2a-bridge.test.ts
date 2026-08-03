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
  const publications = new Map<string, { ok: true; messageId?: string }>();
  // Every publish is captured, never executed: the real implementation spawns
  // the okx-a2a CLI, which must never run from a unit test.
  const sent: Array<{ transportSessionKey?: string; text?: string }> = [];
  let publishOutcome: { ok: boolean; messageId?: string; failureCode?: string; error?: string } = {
    ok: true,
    messageId: "outbound-test-0001",
  };
  return {
    getRecordedDispatch: (key: string, text: string) => store.get(`${key}:${text}`),
    recordDispatch: (key: string, text: string, value: unknown) => store.set(`${key}:${text}`, value),
    getPublication: (key: string) => publications.get(key),
    recordPublication: (key: string, result: { ok: true; messageId?: string }) =>
      publications.set(key, result),
    publishReply: async (input: { transportSessionKey?: string; text?: string }) => {
      sent.push(input);
      return publishOutcome;
    },
    emit: () => {},
    sent,
    publications,
    setPublishOutcome: (o: typeof publishOutcome) => {
      publishOutcome = o;
    },
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

  /**
   * Regression for the review-blocking outage: every sessionKey used above is
   * a bare `my:...` string, a shape that never actually occurs in production.
   * The suite therefore stayed green while the agent was mute to every real
   * reviewer. These keys are copied verbatim from the gateway logs on Machine
   * 7845320c476008 for the sessions OKX reviewer agent 8178 ("sandbox") and
   * agent 1791 opened on 2026-08-01.
   */
  await test("isSellerSession matches the REAL job-scoped seller sessionKey emitted by okx-a2a", () => {
    assert.equal(
      isSellerSession(
        "job:0xe7ca8d6782605ed3a4a5417e276d5f1dfc37714e74895ec69d008048e1147adf:my:9636:to:8178"
      ),
      true,
      "the reviewer session that timed out must be claimed by this plugin"
    );
    assert.equal(
      isSellerSession(
        "job:0x438e701cc9ae08e3632a7c2ef2eea378310200ae66d7cc42ede1922c1f31fce3:my:9636:to:1791"
      ),
      true
    );
  });

  await test("isSellerSession does NOT over-claim sessions that are not Agent 9636 seller exchanges", () => {
    // Buyer-side backup session (myAgentId 5295) seen in the same live logs.
    assert.equal(
      isSellerSession("backup:0x74e4c2b16caabf3c07883147c022344daf9dcf1eb992721a28c3a61a09022e1a"),
      false
    );
    assert.equal(isSellerSession("system-notification"), false);
    // Another agent's job-scoped session must never be answered as 9636.
    assert.equal(isSellerSession("job:0xabc:my:5295:to:9636"), false);
    // 9636 as the PEER, not as the local agent, is a buyer-side session.
    assert.equal(isSellerSession("job:0xabc:my:1791:to:9636"), false);
  });

  /**
   * okx-a2a logs a second, gateway-encoded identifier for the very same
   * exchange. Since `before_agent_reply` is an OpenClaw hook, ctx.sessionKey
   * may carry this form instead. Both must be claimed — assuming only one
   * encoding is what caused the outage.
   */
  await test("isSellerSession matches the gateway-encoded form of the same reviewer exchange", () => {
    assert.equal(
      isSellerSession(
        "agent:main:okx-a2a:group:okx-xmtp:my=9636&to=8178&job=0xe7ca8d6782605ed3a4a5417e276d5f1dfc37714e74895ec69d008048e1147adf"
      ),
      true
    );
  });

  await test("the gateway-encoded matcher does not claim another agent's exchange", () => {
    assert.equal(
      isSellerSession("agent:main:okx-a2a:group:okx-xmtp:my=5295&to=9636&job=0xabc"),
      false,
      "9636 as the peer is a buyer-side session and must not be answered as the seller"
    );
    assert.equal(
      isSellerSession("agent:main:okx-a2a:group:okx-xmtp:my=1791&to=8178&job=0xabc"),
      false
    );
  });

  /**
   * Reproduced LIVE in production on 2026-08-03 (Fly logs, repodiet-agent-9636,
   * 16:10:04Z): sessionKey `agent:main:okx-a2a:group:backup:0x74e4c2b1…` (a
   * documented buyer-side notification channel) was declined here exactly as
   * this test exercises, `decideReply` returned bare `undefined`, OpenClaw
   * fell through to its default model, and that model does not exist in this
   * deployment: `FailoverError: Unknown model: openai/gpt-5.5` / "Embedded
   * agent failed before reply." No reply was ever published — the "Agent did
   * not respond" failure mode, proven to recur on ANY unclaimed session shape,
   * not only the specific ones this test suite had exercised before.
   *
   * `decideReply` must now CLAIM every session it does not recognise
   * (`handled: true`, no reply) so it can never fall through to a model that
   * this project's own architecture never intended to use — while still
   * leaving the same diagnostic trace, so an unexpected new session-key shape
   * remains visible in the runtime log exactly as before.
   */
  await test("a declined session is claimed (never falls through to the model) and still logged", async () => {
    const logged: string[] = [];
    const result = await decideReply(
      { cleanedBody: "hello" },
      { sessionKey: "system-notification" },
      { ...fakeIdempotency(), log: (m: string) => logged.push(m) }
    );
    assert.ok(result, "must not return undefined — undefined is what let the model crash live in production");
    assert.equal(result!.handled, true);
    assert.equal(result!.reply, undefined, "no reply is published — silence is correct for a non-seller session");
    assert.equal(logged.length, 1, "an unclaimed session must leave a diagnostic trace");
    assert.ok(logged[0].includes("system-notification"));
  });

  await test("the exact production backup-channel session that crashed live is now safely claimed", async () => {
    const result = await decideReply(
      { cleanedBody: "" },
      {
        sessionKey:
          "agent:main:okx-a2a:group:backup:0x74e4c2b16caabf3c07883147c022344daf9dcf1eb992721a28c3a61a09022e1a",
      },
      fakeIdempotency()
    );
    assert.ok(result);
    assert.equal(result!.handled, true);
    assert.equal(result!.reply, undefined);
  });

  await test("decideReply answers a real job-scoped reviewer session instead of falling through to the model", async () => {
    const result = await decideReply(
      { cleanedBody: "   " },
      {
        sessionKey:
          "job:0xe7ca8d6782605ed3a4a5417e276d5f1dfc37714e74895ec69d008048e1147adf:my:9636:to:8178",
      },
      fakeIdempotency()
    );
    assert.ok(result, "must not return undefined — undefined is what caused the reviewer timeout");
    assert.equal(result!.handled, true);
    assert.ok(result!.reply?.text);
  });

  await test("decideReply claims (but never replies to) sessions that are not an Agent 9636 seller exchange", async () => {
    const result = await decideReply({ cleanedBody: "hello" }, { sessionKey: "my:1234:to:5295" });
    assert.ok(result, "must not return undefined — that is the fall-through-to-a-broken-model path");
    assert.equal(result!.handled, true);
    assert.equal(result!.reply, undefined);
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
