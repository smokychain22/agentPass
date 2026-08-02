import assert from "node:assert/strict";
import {
  parseSessionKey,
  toTransportSessionKey,
  describeSessionKeyShape,
} from "../openclaw-plugins/repodiet-a2a-bridge/session-key.js";
import { publishReply } from "../openclaw-plugins/repodiet-a2a-bridge/publish.js";
import { decideReply } from "../openclaw-plugins/repodiet-a2a-bridge/logic.js";

function test(name: string, fn: () => Promise<void> | void) {
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
 * Closes the second half of the reviewer-timeout outage.
 *
 * After the session-key fix (PR #139) the bridge correctly claimed reviewer
 * sessions and generated a reply — proven in production at 2026-08-02T12:16:38
 * for OKX reviewer agent 8178, where the assistant reply was written to the
 * OpenClaw transcript with usage totalTokens=0 (i.e. deterministically, with
 * no model call). But no outbound XMTP envelope was ever published, because
 * nothing in the okx-a2a plugin publishes a hook-handled reply. The agent
 * thought of an answer and still said nothing.
 */

// The exact keys observed live on Machine 7845320c476008.
const REVIEWER_8178_GATEWAY =
  "agent:main:okx-a2a:group:okx-xmtp:my=9636&to=8178&job=0xe7ca8d6782605ed3a4a5417e276d5f1dfc37714e74895ec69d008048e1147adf";
const REVIEWER_8178_TRANSPORT =
  "job:0xe7ca8d6782605ed3a4a5417e276d5f1dfc37714e74895ec69d008048e1147adf:my:9636:to:8178";
const REVIEWER_1791_TRANSPORT =
  "job:0x438e701cc9ae08e3632a7c2ef2eea378310200ae66d7cc42ede1922c1f31fce3:my:9636:to:1791";

function deps(overrides: Record<string, unknown> = {}) {
  const sent: Array<{ transportSessionKey?: string; text?: string }> = [];
  const publications = new Map<string, unknown>();
  return {
    sent,
    publications,
    d: {
      dispatchCreateTask: async () => ({ status: 200, body: { message: "RepoDiet is online." } }),
      dispatchAnalyzeRepository: async () => ({ status: 200, body: { findings: [] } }),
      getRecordedDispatch: () => undefined,
      recordDispatch: () => {},
      getPublication: (k: string) => publications.get(k),
      recordPublication: (k: string, r: unknown) => publications.set(k, r),
      publishReply: async (input: { transportSessionKey?: string; text?: string }) => {
        sent.push(input);
        return { ok: true, messageId: "outbound-abc" };
      },
      emit: () => {},
      log: () => {},
      ...overrides,
    } as Record<string, unknown>,
  };
}

async function run() {
  console.log("repodiet-a2a-publication");

  // --- session key parsing across both real encodings --------------------

  await test("the gateway-encoded reviewer key is converted to the transport key xmtp-send needs", () => {
    const parsed = parseSessionKey(REVIEWER_8178_GATEWAY);
    assert.equal(parsed?.myAgentId, "9636");
    assert.equal(parsed?.peerAgentId, "8178");
    assert.equal(toTransportSessionKey(parsed), REVIEWER_8178_TRANSPORT);
  });

  await test("the transport reviewer keys round-trip unchanged", () => {
    for (const key of [REVIEWER_8178_TRANSPORT, REVIEWER_1791_TRANSPORT]) {
      assert.equal(toTransportSessionKey(parseSessionKey(key)), key);
    }
  });

  await test("non-exchange session keys parse to nothing and can never be published on", () => {
    for (const key of [
      "backup:0x74e4c2b16caabf3c07883147c022344daf9dcf1eb992721a28c3a61a09022e1a",
      "system-notification",
      "agent:main:main",
    ]) {
      assert.equal(parseSessionKey(key), undefined, key);
      assert.equal(toTransportSessionKey(parseSessionKey(key)), undefined, key);
    }
  });

  await test("a jobless key yields no transport key — a reply is never sent against a fabricated job", () => {
    assert.equal(toTransportSessionKey(parseSessionKey("my:9636:to:5295")), undefined);
  });

  await test("session key shape is describable without leaking the jobId", () => {
    const shape = describeSessionKeyShape(REVIEWER_8178_GATEWAY);
    assert.equal(shape, "gateway+job");
    assert.ok(!shape.includes("0xe7ca"), "must not embed the job identifier");
  });

  // --- handled replies actually reach the transport ----------------------

  await test("a claimed reviewer message is PUBLISHED, not merely returned", async () => {
    const { sent, d } = deps();
    const result = await decideReply(
      { cleanedBody: "Please clean up https://github.com/owner/repo" },
      { sessionKey: REVIEWER_8178_GATEWAY, jobId: "job-a" },
      d
    );
    assert.equal(result?.handled, true);
    assert.equal(sent.length, 1, "exactly one outbound publication must be attempted");
    assert.equal(sent[0].transportSessionKey, REVIEWER_8178_TRANSPORT);
    assert.ok(sent[0].text, "the published text must be the generated reply");
  });

  await test("an exact redelivery of the same inbound message publishes only once", async () => {
    const { sent, d } = deps();
    const event = { cleanedBody: "Please clean up https://github.com/owner/repo" };
    const ctx = { sessionKey: REVIEWER_8178_GATEWAY, jobId: "job-a", runId: "inbound-msg-1" };
    await decideReply(event, ctx, d);
    await decideReply(event, ctx, d);
    assert.equal(sent.length, 1, "the second delivery of the same envelope must not resend");
  });

  await test("distinct follow-ups under ONE job each get their own reply", async () => {
    const { sent, d } = deps();
    // Reviewer 8178 sent five messages under a single job on 2026-08-01.
    for (const runId of ["m1", "m2", "m3", "m4", "m5"]) {
      await decideReply(
        { cleanedBody: `follow-up ${runId}` },
        { sessionKey: REVIEWER_8178_GATEWAY, jobId: "job-a", runId },
        d
      );
    }
    assert.equal(sent.length, 5, "collapsing follow-ups would answer only the first reviewer message");
  });

  await test("identical text arriving as two DIFFERENT transport messages is not suppressed", async () => {
    const { sent, d } = deps();
    const body = { cleanedBody: "Standing by for your response." };
    await decideReply(body, { sessionKey: REVIEWER_8178_GATEWAY, jobId: "job-a", runId: "x1" }, d);
    await decideReply(body, { sessionKey: REVIEWER_8178_GATEWAY, jobId: "job-a", runId: "x2" }, d);
    assert.equal(sent.length, 2, "a new transport message id means a new message, even with repeated text");
  });

  await test("the same message id under DIFFERENT jobs never collides", async () => {
    const { sent, d } = deps();
    await decideReply({ cleanedBody: "hi" }, { sessionKey: REVIEWER_8178_GATEWAY, jobId: "job-a", runId: "same" }, d);
    await decideReply({ cleanedBody: "hi" }, { sessionKey: REVIEWER_8178_GATEWAY, jobId: "job-b", runId: "same" }, d);
    assert.equal(sent.length, 2);
  });

  // --- failures stay visible and retryable -------------------------------

  await test("a transport failure is NOT recorded as published, so the reply stays retryable", async () => {
    const publications = new Map<string, unknown>();
    let attempts = 0;
    const d = {
      ...deps().d,
      getPublication: (k: string) => publications.get(k),
      recordPublication: (k: string, r: unknown) => publications.set(k, r),
      publishReply: async () => {
        attempts++;
        return attempts === 1
          ? { ok: false, failureCode: "TRANSPORT_REJECTED", error: "task expired" }
          : { ok: true, messageId: "outbound-retry-ok" };
      },
    };
    const ctx = { sessionKey: REVIEWER_8178_GATEWAY, jobId: "job-a", runId: "retry-me" };
    await decideReply({ cleanedBody: "hello" }, ctx, d);
    assert.equal(publications.size, 0, "a failed publication must never be recorded as done");
    await decideReply({ cleanedBody: "hello" }, ctx, d);
    assert.equal(attempts, 2, "the retry must actually re-attempt the send");
    assert.equal(publications.size, 1, "the successful retry is recorded");
  });

  await test("a publish failure is surfaced with an explicit failure code, never silently swallowed", async () => {
    const events: Array<Record<string, unknown>> = [];
    const d = {
      ...deps().d,
      publishReply: async () => ({ ok: false, failureCode: "TRANSPORT_REJECTED", error: "closed" }),
      emit: (f: Record<string, unknown>) => events.push(f),
    };
    await decideReply({ cleanedBody: "hello" }, { sessionKey: REVIEWER_8178_GATEWAY, jobId: "j" }, d);
    assert.equal(events.length, 1);
    assert.equal(events[0].outcome, "publish_failed");
    assert.equal(events[0].failureCode, "TRANSPORT_REJECTED");
    assert.equal(events[0].publicationStatus, "failed");
  });

  await test("observability records the outbound message id and never the reply text", async () => {
    const events: Array<Record<string, unknown>> = [];
    const d = { ...deps().d, emit: (f: Record<string, unknown>) => events.push(f) };
    await decideReply({ cleanedBody: "hello" }, { sessionKey: REVIEWER_8178_GATEWAY, jobId: "j" }, d);
    const e = events[0];
    assert.equal(e.outcome, "published");
    assert.equal(e.outboundMessageId, "outbound-abc");
    assert.equal(e.claimed, true);
    assert.equal(e.peerAgentId, "8178");
    assert.equal(e.localAgentId, "9636");
    assert.ok(!JSON.stringify(e).includes("RepoDiet is online"), "reply text must not be logged");
  });

  // --- publish.js guards -------------------------------------------------

  await test("publishReply refuses to send without a job-scoped transport key", async () => {
    const r = await publishReply({ transportSessionKey: undefined, text: "hi" });
    assert.equal(r.ok, false);
    assert.equal(r.failureCode, "NO_TRANSPORT_SESSION_KEY");
  });

  await test("publishReply refuses to publish an empty reply", async () => {
    const r = await publishReply({ transportSessionKey: REVIEWER_8178_TRANSPORT, text: "   " });
    assert.equal(r.ok, false);
    assert.equal(r.failureCode, "EMPTY_REPLY");
  });

  await test("a CLI refusal (ok:false) is reported as a failure, never as a success", async () => {
    const r = await publishReply(
      { transportSessionKey: REVIEWER_8178_TRANSPORT, text: "hi" },
      {
        execFile: (_bin: string, _args: string[], _opts: unknown, cb: Function) =>
          cb(null, '{"ok":false,"error":"message is not eligible for this task/group"}', ""),
      }
    );
    assert.equal(r.ok, false);
    assert.equal(r.failureCode, "TRANSPORT_REJECTED");
    assert.match(String(r.error), /not eligible/);
  });

  await test("the real CLI success shape yields the outbound message id", async () => {
    const r = await publishReply(
      { transportSessionKey: REVIEWER_8178_TRANSPORT, text: "hi" },
      {
        execFile: (_bin: string, _args: string[], _opts: unknown, cb: Function) =>
          cb(
            null,
            '[2026-08-02T12:15:46.754Z] [okx-agent-task] gateway noise\n{"ok":true,"commandId":"c1","messageId":"outbound-d1272f15","error":null}',
            ""
          ),
      }
    );
    assert.equal(r.ok, true);
    assert.equal(r.messageId, "outbound-d1272f15");
  });

  /**
   * Live loop with OKX reviewer 8178 at 2026-08-02T15:29: they wrote "The task
   * is: type=create_cleanup_pr", the intake saw no `type` field and answered
   * "could not map it to a cleanup task type", so they restated it and we
   * denied it again. Intent stated in prose must reach the intake as a type.
   */
  await test("a stated cleanup intent is forwarded as a task type, ending the INVALID_TASK_TYPE loop", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const d = {
      ...deps().d,
      dispatchCreateTask: async (body: Record<string, unknown>) => {
        calls.push(body);
        return { status: 400, body: { message: "Provide the repository URL." } };
      },
    };
    await decideReply(
      { cleanedBody: "The task is: type=create_cleanup_pr. Awaiting the repository URL." },
      { sessionKey: REVIEWER_8178_GATEWAY, jobId: "j" },
      d
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].type, "repository.safe_cleanup");
  });

  await test("a discovery question is NOT coerced into a cleanup task type", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const d = {
      ...deps().d,
      dispatchCreateTask: async (body: Record<string, unknown>) => {
        calls.push(body);
        return { status: 200, body: { message: "RepoDiet is online." } };
      },
    };
    await decideReply(
      { cleanedBody: "Hello, what services do you offer?" },
      { sessionKey: REVIEWER_8178_GATEWAY, jobId: "j" },
      d
    );
    assert.equal(calls[0].type, undefined, "discovery must still reach the informational path");
  });

  await test("no model is ever consulted for a seller session — publication needs no provider", async () => {
    const { d } = deps();
    const result = await decideReply(
      { cleanedBody: "anything at all" },
      { sessionKey: REVIEWER_8178_GATEWAY, jobId: "j" },
      d
    );
    assert.equal(result?.handled, true, "handled:true is what prevents the model turn entirely");
  });

  console.log("repodiet-a2a-publication: all passed");
}

run();
