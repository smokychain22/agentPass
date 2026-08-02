/**
 * Explicit XMTP publication for bridge-generated seller replies.
 *
 * WHY THIS EXISTS — the defect it closes, traced end to end in production on
 * 2026-08-02 for the real OKX reviewer session (agent 8178, job 0xe7ca8d67…):
 *
 *   12:16:38.133  inbound envelope written to the OpenClaw session
 *   12:16:38.140  assistant reply recorded, usage totalTokens=0  (our bridge)
 *   12:16:38.249  session-gate released state=final
 *   …            NO outbound xmtp envelope, ever
 *
 * Returning `{ handled: true, reply }` is honoured by OpenClaw — verified in
 * the installed runtime, dist/get-reply-*.js:
 *     if (hookResult?.handled) { …; return hookResult.reply ?? { text: "NO_REPLY" }; }
 * — and the reply IS persisted to the session transcript. But publication back
 * onto XMTP is not OpenClaw's job here: @okxweb3/okx-a2a-openclaw registers
 * only `before_agent_run` and `agent_end` (see its openclaw.plugin.json), its
 * `agent_end` handler performs cleanup only, and the plugin states outright
 * that "node daemon owns XMTP receive/send/agent sync". Every outbound send in
 * the daemon is driven by a queued command. Nothing enqueues one for a
 * hook-handled reply, so the reply is generated, stored, and silently dropped.
 *
 * That is the residual half of the reviewer timeout: after the session-key fix
 * the agent now THINKS of a reply, but still says nothing.
 *
 * We do not patch vendor dist. Instead the bridge publishes its own reply
 * through the daemon's documented public interface (`okx-a2a xmtp-send`,
 * "Queue an XMTP message through the running daemon") — the exact path proven
 * to work by hand for both reviewer sessions. Publication is recorded in a
 * ledger so a success is never repeated while a transport failure stays
 * retryable.
 */
import { execFile } from "node:child_process";

const DEFAULT_CLI = process.env.REPODIET_OKX_A2A_BIN || "okx-a2a";
const PUBLISH_TIMEOUT_MS = 30_000;

/**
 * Publishes one reply. Returns a structured result rather than throwing, so a
 * transport failure is surfaced and stays retryable instead of turning into
 * another silent non-answer.
 */
export function publishReply(input, deps = {}) {
  const run = deps.execFile ?? execFile;
  const { transportSessionKey, text } = input;

  if (!transportSessionKey) {
    return Promise.resolve({
      ok: false,
      messageId: undefined,
      failureCode: "NO_TRANSPORT_SESSION_KEY",
      error: "reply has no job-scoped transport session key to publish on",
    });
  }
  if (!text || !String(text).trim()) {
    return Promise.resolve({
      ok: false,
      messageId: undefined,
      failureCode: "EMPTY_REPLY",
      error: "refusing to publish an empty reply",
    });
  }

  return new Promise((resolve) => {
    run(
      DEFAULT_CLI,
      ["xmtp-send", "--session-key", transportSessionKey, "--message", String(text), "--json"],
      { timeout: PUBLISH_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        const parsed = parseCliJson(stdout);
        if (parsed && parsed.ok === true) {
          resolve({ ok: true, messageId: parsed.messageId ?? undefined, failureCode: undefined });
          return;
        }
        // The CLI reports refusals (expired/closed job, ineligible peer) as
        // ok:false WITH a reason. Surface the real reason verbatim — never
        // reinterpret a refusal as a success.
        resolve({
          ok: false,
          messageId: undefined,
          failureCode: parsed ? "TRANSPORT_REJECTED" : "TRANSPORT_INVOCATION_FAILED",
          error: parsed?.error ?? err?.message ?? "okx-a2a xmtp-send produced no parseable result",
        });
      }
    );
  });
}

function parseCliJson(stdout) {
  const out = String(stdout ?? "");
  // The CLI interleaves gateway log lines with its JSON result, so scan for
  // the last JSON object rather than assuming the whole stream parses.
  const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].startsWith("{")) continue;
    try {
      return JSON.parse(lines[i]);
    } catch {
      /* keep scanning older lines */
    }
  }
  return undefined;
}
