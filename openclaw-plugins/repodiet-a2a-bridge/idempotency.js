/**
 * Local idempotency store keyed by the okx-a2a job/session identity, so a
 * retried or duplicate inbound message (network retry, XMTP redelivery)
 * replays the same real dispatch result instead of resubmitting a second
 * A2A task or a second A2MCP quote request. Persisted under HOME so it
 * survives a container restart (HOME=/persistent/home in production) —
 * matches "task retry updates the same task/branch/PR" rather than
 * creating a duplicate.
 *
 * Deliberately simple: this is a replay cache, not a task-state machine.
 * It stores exactly what was dispatched and exactly what came back; it
 * never invents or upgrades a stored result.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function storeDir() {
  const base = process.env.XDG_DATA_HOME || process.env.HOME || process.cwd();
  return path.join(base, "repodiet-a2a-bridge");
}

function storePath() {
  return path.join(storeDir(), "dispatch-idempotency.json");
}

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(storePath(), "utf8"));
  } catch {
    return {};
  }
}

function writeStore(store) {
  const dir = storeDir();
  fs.mkdirSync(dir, { recursive: true });
  // Write-then-rename: a crash mid-write must never leave a truncated,
  // unparseable store (which would silently disable idempotency).
  const tmp = path.join(dir, `.dispatch-idempotency.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(store), "utf8");
  fs.renameSync(tmp, storePath());
}

function recordKey(identityKey, messageText) {
  const digest = crypto.createHash("sha256").update(messageText).digest("hex").slice(0, 16);
  return `${identityKey}:${digest}`;
}

export function getRecordedDispatch(identityKey, messageText) {
  if (!identityKey) return undefined;
  const store = readStore();
  return store[recordKey(identityKey, messageText)];
}

export function recordDispatch(identityKey, messageText, result) {
  if (!identityKey) return;
  const store = readStore();
  store[recordKey(identityKey, messageText)] = { ...result, recordedAt: new Date().toISOString() };
  writeStore(store);
}

/**
 * Derives the identity of ONE inbound transport message.
 *
 * Keying replies by jobId alone is wrong: a reviewer sends many follow-ups
 * under a single job (agent 8178 sent five on 2026-08-01), and collapsing them
 * would answer only the first. Keying by normalized text alone is also wrong:
 * two genuinely distinct messages can repeat a phrase.
 *
 * So we prefer, in order:
 *   1. ctx.runId — on the dispatch path this IS the inbound transport message
 *      id (verified in the live logs: `dispatchSessionMessage …
 *      messageId=68d5e82f…` and `[session-gate] holding … runId=68d5e82f…`
 *      are the same value).
 *   2. an id carried inside the A2A envelope itself.
 *   3. the envelope's own transport timestamp, when non-zero.
 *   4. a content digest, as a last resort.
 * Each is combined with the job/session context so identities can never
 * collide across exchanges.
 */
export function deriveInboundIdentity(cleanedBody, ctx) {
  const scope = ctx?.jobId || ctx?.sessionKey || "unknown-scope";

  if (ctx?.runId) return { key: `${scope}:run:${ctx.runId}`, source: "run_id" };

  const envelope = parseEnvelope(cleanedBody);
  const envelopeId = envelope?.messageId ?? envelope?.id;
  if (envelopeId) return { key: `${scope}:msg:${envelopeId}`, source: "envelope_message_id" };

  const sentAt = Number(envelope?.xmtpSentAtMs);
  if (Number.isFinite(sentAt) && sentAt > 0) {
    return { key: `${scope}:sent:${sentAt}`, source: "envelope_sent_at" };
  }

  const digest = crypto
    .createHash("sha256")
    .update(String(cleanedBody ?? ""))
    .digest("hex")
    .slice(0, 24);
  return { key: `${scope}:body:${digest}`, source: "content_digest" };
}

function parseEnvelope(cleanedBody) {
  const text = String(cleanedBody ?? "").trim();
  if (!text.startsWith("{")) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Publication ledger, deliberately separate from the dispatch cache: a
 * dispatch that produced a reply is NOT proof the reply reached XMTP. Only a
 * recorded successful publication suppresses a resend, so a transport failure
 * remains retryable while a published reply is never duplicated.
 */
export function getPublication(inboundKey) {
  if (!inboundKey) return undefined;
  const store = readStore();
  return store[`published:${inboundKey}`];
}

export function recordPublication(inboundKey, result) {
  if (!inboundKey || !result?.ok) return;
  const store = readStore();
  store[`published:${inboundKey}`] = {
    ok: true,
    messageId: result.messageId,
    publishedAt: new Date().toISOString(),
  };
  writeStore(store);
}
