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
