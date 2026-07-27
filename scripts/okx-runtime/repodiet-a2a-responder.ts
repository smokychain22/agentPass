#!/usr/bin/env tsx
/**
 * RepoDiet's own deterministic A2A responder. Watches the official
 * okx-a2a task inbox and answers safe, pre-work messages (availability,
 * capability, price, repository/scope requests) directly from RepoDiet
 * code, using only the CLI's transport primitives:
 *
 *   inbound:  okx-a2a user watch --json      (long-poll, no AI provider)
 *   outbound: okx-a2a xmtp-send ...           (signed via onchainos agent
 *                                              xmtp-sign --key-uuid <id>,
 *                                              the agent's own wallet key
 *                                              — no AI provider)
 *
 * `okx-a2a ai exec` / `ai resume` (the only commands that take
 * --provider codex|claude|hermes) are never invoked. `okx-a2a session
 * send` is also never used here — its own --help text describes it as
 * "Queue a local AI session message dispatch", a different, AI-session-
 * internal relay, not the genuine outbound XMTP transport.
 *
 * Anything that does not match a known safe pattern is left untouched
 * (not claimed, not answered) so it stays in the outstanding-decisions
 * queue for a human / interactive session — this script never
 * approves spending, funds or releases escrow, accepts a paid task or
 * delivery, starts a scan/branch/PR, or alters Agent registration.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  isInformationalQuery,
  isMarketplaceDiscoveryMessage,
} from "../../src/lib/a2a/marketplace-intake";

const execFileAsync = promisify(execFile);

const ASP_AGENT_ID = "9636";
const RUNTIME_DIR = path.join(
  process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || ".", "AppData", "Local"),
  "RepoDiet",
  "okx-a2a-responder"
);
const LOG_DIR = path.join(RUNTIME_DIR, "logs");
const LOCK_FILE = path.join(RUNTIME_DIR, "responder.lock");
const LOG_FILE = path.join(LOG_DIR, "responder.log");

fs.mkdirSync(LOG_DIR, { recursive: true });

function log(level: string, message: string): void {
  const line = `${new Date().toISOString()} [${level}] ${message}`;
  fs.appendFileSync(LOG_FILE, line + "\n");
  console.log(line);
}

function isDuplicateInstance(): boolean {
  if (!fs.existsSync(LOCK_FILE)) return false;
  const pid = Number(fs.readFileSync(LOCK_FILE, "utf8").trim());
  if (!Number.isFinite(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLock(): void {
  fs.writeFileSync(LOCK_FILE, String(process.pid));
}

function releaseLock(): void {
  try {
    const held = Number(fs.readFileSync(LOCK_FILE, "utf8").trim());
    if (held === process.pid) fs.rmSync(LOCK_FILE, { force: true });
  } catch {
    // already gone
  }
}

interface WatchItem {
  id: string;
  kind: "notification" | "decision_request";
  jobId?: string;
  sessionKey?: string;
  userContent?: string;
  createdAt?: string;
}

interface WatchResult {
  ok: boolean;
  items?: WatchItem[];
}

async function watchOnce(): Promise<WatchResult> {
  const { stdout } = await execFileAsync("okx-a2a", ["user", "watch", "--json"], {
    maxBuffer: 20 * 1024 * 1024,
    timeout: 0,
  });
  const lines = stdout.trim().split("\n");
  const jsonLine = lines.reverse().find((line) => line.trim().startsWith("{"));
  if (!jsonLine) return { ok: true, items: [] };
  const parsed = JSON.parse(jsonLine) as { ok: boolean; items?: WatchItem[] };
  return { ok: parsed.ok, items: parsed.items ?? [] };
}

/** Only act when Agent 9636 is the seller (ASP) side of this exchange. Returns the counterparty agentId, or null. */
function sellerSideCounterparty(item: WatchItem): string | null {
  const match = item.sessionKey?.match(/my:9636:to:(\w+)/);
  return match ? match[1] : null;
}

const SAFE_REPLY =
  "RepoDiet Agent 9636 is online.\n\n" +
  "Quick Triage, service 37347, provides read-only repository analysis for 0.03 USD₮0.\n\n" +
  "Verified Cleanup, service 37348, creates a tested GitHub pull request through the A2A task and escrow workflow. Its registered default fee is 1 USD₮0.\n\n" +
  "Please provide the GitHub repository URL and requested scope. No work or payment has started.";

async function claimTodo(id: string): Promise<boolean> {
  const { stdout } = await execFileAsync("okx-a2a", ["user", "check", "--todo-ids", id, "--json"]);
  const parsed = JSON.parse(stdout.trim());
  return Array.isArray(parsed.handled) && parsed.handled.includes(id);
}

async function sendReply(jobId: string, toAgentId: string, message: string): Promise<void> {
  await execFileAsync("okx-a2a", [
    "xmtp-send",
    "--job-id",
    jobId,
    "--to-agent-id",
    toAgentId,
    "--message",
    message,
    "--json",
  ]);
}

async function handleItem(item: WatchItem): Promise<void> {
  if (item.kind === "notification") {
    log("INFO", `notification id=${item.id} jobId=${item.jobId ?? "-"} (auto-consumed, no action needed)`);
    return;
  }
  if (item.kind !== "decision_request") return;

  const toAgentId = sellerSideCounterparty(item);
  if (!toAgentId) {
    log("INFO", `decision_request id=${item.id} is not a seller-side (Agent ${ASP_AGENT_ID}) exchange - leaving pending for interactive review`);
    return;
  }

  const text = item.userContent ?? "";
  const safe = isMarketplaceDiscoveryMessage(text) || isInformationalQuery(text);
  if (!safe) {
    log(
      "INFO",
      `decision_request id=${item.id} jobId=${item.jobId} does not match a known safe pre-work pattern - leaving pending, no automatic response (payment/escrow/irreversible items always require explicit approval)`
    );
    return;
  }
  if (!item.jobId) {
    log("WARN", `decision_request id=${item.id} matched a safe pattern but has no jobId - cannot reply, leaving pending`);
    return;
  }

  const startedAt = Date.now();
  const claimed = await claimTodo(item.id);
  if (!claimed) {
    log("INFO", `decision_request id=${item.id} already handled elsewhere - skipping`);
    return;
  }
  await sendReply(item.jobId, toAgentId, SAFE_REPLY);
  const latencyMs = Date.now() - startedAt;
  log(
    "INFO",
    `RESPONDED id=${item.id} jobId=${item.jobId} toAgentId=${toAgentId} latencyMs=${latencyMs} (deterministic template, no AI provider invoked)`
  );
}

async function main(): Promise<void> {
  if (isDuplicateInstance()) {
    log("INFO", "Another responder instance is already active - exiting to prevent duplicates.");
    return;
  }
  acquireLock();
  process.on("exit", releaseLock);
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));

  log("INFO", `RepoDiet A2A responder starting. PID=${process.pid}`);
  for (;;) {
    try {
      const result = await watchOnce();
      for (const item of result.items ?? []) {
        try {
          await handleItem(item);
        } catch (error) {
          log("ERROR", `handleItem failed for id=${item.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      log("ERROR", `watch tick failed: ${error instanceof Error ? error.message : String(error)}`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

main();
