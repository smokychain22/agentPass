#!/usr/bin/env tsx
/**
 * RepoDiet seller runtime — the always-online production process for
 * Agent 9636.
 *
 * This replaces the workstation launcher model. scripts/okx-runtime-manager.ts
 * is a *launcher*: it spawns detached background children and exits, which
 * suits a developer workstation but cannot be a container entrypoint, because
 * a container needs a foreground PID 1 that lives as long as the work does.
 *
 * This runs in the foreground, owns its children, verifies identity before
 * claiming anything, publishes heartbeats only when the official gate-check
 * genuinely passes, and shuts down cleanly on SIGTERM/SIGINT.
 *
 * Deliberate constraints:
 *   - never claims "online" from process existence alone;
 *   - refuses to start as any agent other than the canonical seller;
 *   - refuses to start a second instance against the same data root;
 *   - never logs secrets, tokens, or key material.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  ensureRuntimeLayout,
  getRuntimePaths,
  OKX_RUNTIME_IDENTITIES,
  readLivePid,
  writePid,
} from "../src/lib/okx-runtime/runtime-layout";

const execFileAsync = promisify(execFile);

const SELLER = OKX_RUNTIME_IDENTITIES.seller;
const A2A_SERVICE_ID = "37348";
const COMMUNICATION_ADDRESS = "0x00dbdbb36b71ace0e1fc517056f376f977d8256e";

/**
 * @okxweb3/a2a-node exposes exactly four providers (codex, claude, hermes,
 * openclaw) and no generic process/webhook/MCP/HTTP-callback adapter — see
 * `okx-a2a daemon --help` / `okx-a2a config provider --help`. openclaw is the
 * default here because it is the documented host-agnostic Agent host; hermes
 * is supported as an explicit override. codex/claude are never valid in this
 * runtime — they are development tools, never the production responder.
 */
const A2A_PROVIDER = (process.env.REPODIET_OKX_A2A_PROVIDER?.trim() || "openclaw").toLowerCase();
const SUPPORTED_PROVIDERS = new Set(["openclaw", "hermes"]);

const BASE_URL = (
  process.env.REPODIET_PRODUCTION_URL || "https://skillswap-virid-kappa.vercel.app"
).replace(/\/$/, "");
const HEARTBEAT_SECRET = process.env.REPODIET_OKX_RUNTIME_HEARTBEAT_SECRET;
const HEARTBEAT_INTERVAL_MS = Number(process.env.REPODIET_SELLER_HEARTBEAT_INTERVAL_MS || 60_000);
const HEARTBEAT_TTL_SECONDS = Number(process.env.REPODIET_SELLER_HEARTBEAT_TTL_SECONDS || 90);

/** Container-neutral data root. Falls back to XDG on Linux, AppData on Windows. */
function resolveRuntimeRoot(): string {
  const explicit = process.env.REPODIET_OKX_RUNTIME_ROOT?.trim();
  if (explicit) return path.resolve(explicit);
  const platformData =
    process.env.XDG_DATA_HOME?.trim() ||
    process.env.LOCALAPPDATA?.trim() ||
    (process.platform === "win32"
      ? path.join(os.homedir(), "AppData", "Local")
      : path.join(os.homedir(), ".local", "share"));
  return path.resolve(path.join(platformData, "RepoDiet", "okx-runtimes"));
}

type LogFields = Record<string, unknown>;

function log(event: string, fields: LogFields = {}): void {
  // Structured, single-line, and deliberately free of any secret-bearing
  // field. Callers pass observations, never credentials.
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...fields }));
}

let shuttingDown = false;
let heartbeatTimer: NodeJS.Timeout | undefined;
let consecutiveHeartbeatFailures = 0;

/**
 * Identity gate. The runtime refuses to represent anything other than the
 * canonical seller, so a misconfigured deployment fails closed instead of
 * impersonating another agent.
 */
function verifyIdentityOrExit(): void {
  const configuredAgent = process.env.REPODIET_OKX_AGENT_ID?.trim();
  if (configuredAgent && configuredAgent !== SELLER.agentId) {
    log("identity_rejected", {
      reason: "configured_agent_is_not_the_canonical_seller",
      expected: SELLER.agentId,
      configured: configuredAgent,
    });
    process.exit(1);
  }
  const configuredRole = process.env.REPODIET_OKX_RUNTIME_ROLE?.trim();
  if (configuredRole && configuredRole !== "seller") {
    log("identity_rejected", { reason: "buyer_must_not_run_in_the_seller_runtime" });
    process.exit(1);
  }
  if (!HEARTBEAT_SECRET || HEARTBEAT_SECRET.length < 32) {
    // Fail closed: without the shared secret the heartbeat cannot be
    // authenticated, and an unauthenticated runtime must never report online.
    log("startup_failed", { reason: "heartbeat_secret_missing_or_too_short" });
    process.exit(1);
  }
  if (A2A_PROVIDER === "codex" || A2A_PROVIDER === "claude") {
    // Claude/Codex are development tools only and must never front the
    // production ASP responder — see the module-level A2A_PROVIDER comment.
    log("identity_rejected", {
      reason: "codex_and_claude_are_development_tools_only_not_a_production_provider",
      configuredProvider: A2A_PROVIDER,
    });
    process.exit(1);
  }
  if (!SUPPORTED_PROVIDERS.has(A2A_PROVIDER)) {
    log("identity_rejected", {
      reason: "unsupported_a2a_provider",
      configuredProvider: A2A_PROVIDER,
      supported: [...SUPPORTED_PROVIDERS],
    });
    process.exit(1);
  }
  log("identity_verified", {
    agentId: SELLER.agentId,
    a2aServiceId: A2A_SERVICE_ID,
    wallet: SELLER.walletAddress,
    communicationAddress: COMMUNICATION_ADDRESS,
  });
}

/** Single-instance guard. Two live sellers would double-acknowledge tasks. */
function acquireSingleInstanceLock(pidFile: string): void {
  const existing = readLivePid(pidFile);
  if (existing && existing !== process.pid) {
    log("startup_failed", { reason: "another_seller_runtime_is_already_live", pid: existing });
    process.exit(1);
  }
  // readLivePid removes the file when the recorded process is gone, so a
  // stale lock from an unclean shutdown recovers automatically here.
  try {
    writePid(pidFile, process.pid);
  } catch {
    fs.writeFileSync(pidFile, `${process.pid}\n`, "utf8");
  }
  log("instance_lock_acquired", { pid: process.pid, pidFile });
}

async function officialGateCheckPasses(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("onchainos", ["agent", "gate-check", "--role", "asp"]);
    const parsed = JSON.parse(stdout.trim().split("\n").pop() ?? "{}");
    return (
      parsed?.data?.ready === true &&
      parsed?.data?.identity?.agentId === SELLER.agentId &&
      parsed?.data?.communication?.ok === true &&
      parsed?.data?.wallet?.ok === true
    );
  } catch {
    return false;
  }
}

async function xmtpClientActive(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("okx-a2a", ["agent", "refresh", "--json"]);
    const parsed = JSON.parse(stdout.trim());
    return parsed?.ok === true && (parsed?.payload?.activeClients ?? 0) >= 1;
  } catch {
    return false;
  }
}

interface DoctorResult {
  ok: boolean;
  pass: number;
  warn: number;
  fail: number;
}

/**
 * Runs the official readiness/repair command once at startup.
 *
 * Schema verified directly against the real pinned 0.1.11 CLI (not assumed):
 * `okx-a2a doctor --fix --json` writes progress/log lines to STDERR only and
 * exactly one JSON object to STDOUT — `{ ok, ready, summary: { pass, warn,
 * fail, ... }, ... }`. The counts are nested under `summary`, not top-level.
 * `--fix` can take several minutes on a first run (plugin install, daemon
 * start, XMTP warm-up) — the CLI's own advisory says "allow at least 180s",
 * so the exec timeout here is set above that with margin.
 *
 * A human-readable "Summary: X pass, Y warn, Z fail" line is what the same
 * command prints without --json (also directly observed) — kept as a
 * fallback in case a future CLI version ever mixes that text into stdout.
 * Either path fails closed: an unparseable result counts as not ready.
 *
 * Critical, directly-reproduced behavior: the CLI exits NON-ZERO whenever
 * there is any real blocking failure (`{"ok":false,"ready":false,...}`) —
 * which is the ordinary case on a fresh, not-yet-authenticated container,
 * not an execution error. `execFileAsync` rejects on a non-zero exit, but
 * Node still attaches the captured stdout to that rejection (`err.stdout`),
 * so the real diagnostic JSON is read from there rather than discarded.
 */
async function runDoctorFix(): Promise<DoctorResult> {
  let stdout: string;
  try {
    stdout = (await execFileAsync("okx-a2a", ["doctor", "--fix", "--json"], { timeout: 240_000 }))
      .stdout;
  } catch (err) {
    const fromFailedExec = (err as { stdout?: string } | undefined)?.stdout;
    if (!fromFailedExec?.trim()) {
      return { ok: false, pass: 0, warn: 0, fail: -1 };
    }
    stdout = fromFailedExec;
  }
  {
    const trimmed = stdout.trim();
    try {
      const parsed = JSON.parse(trimmed.split("\n").pop() ?? trimmed);
      const summary = parsed?.summary;
      if (
        typeof summary?.pass === "number" &&
        typeof summary?.warn === "number" &&
        typeof summary?.fail === "number"
      ) {
        return {
          ok: parsed?.ready === true && summary.fail === 0,
          pass: summary.pass,
          warn: summary.warn,
          fail: summary.fail,
        };
      }
    } catch {
      // Not a JSON line — fall through to the text-summary parse below.
    }
    const match = trimmed.match(/Summary:\s*(\d+)\s*pass,\s*(\d+)\s*warn,\s*(\d+)\s*fail/i);
    if (match) {
      const pass = Number(match[1]);
      const warn = Number(match[2]);
      const fail = Number(match[3]);
      return { ok: fail === 0, pass, warn, fail };
    }
    return { ok: false, pass: 0, warn: 0, fail: -1 };
  }
}

/** Lightweight liveness probe — no --fix, no plugin install, just status. */
async function daemonIsRunning(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("okx-a2a", ["daemon", "status"], { timeout: 20_000 });
    return /\brunning\b/i.test(stdout) || /\bready\b/i.test(stdout);
  } catch {
    return false;
  }
}

/**
 * Keeps the official A2A daemon alive. The daemon is the OKX CLI's own
 * background process (its own autostart/restart mechanism, not a child we
 * spawn), so "keeping it alive" here means driving its own start/status
 * commands rather than reimplementing process supervision ourselves — per
 * the instruction not to reimplement what the official CLI already owns.
 * Called once per heartbeat tick, so a daemon that dies gets one restart
 * attempt per HEARTBEAT_INTERVAL_MS — a bounded-backoff restart tied to the
 * existing heartbeat cadence rather than a separate fast retry loop.
 */
async function ensureDaemonRunning(): Promise<boolean> {
  if (await daemonIsRunning()) return true;
  try {
    // Verified against the real `okx-a2a daemon --help`: `daemon start`
    // documents only [--provider] [--ai-provider] [--no-autostart] — no
    // --json. Success is confirmed below via the documented `daemon status`
    // check rather than by parsing start's own output.
    await execFileAsync("okx-a2a", ["daemon", "start", "--provider", A2A_PROVIDER], {
      timeout: 60_000,
    });
  } catch {
    return false;
  }
  return daemonIsRunning();
}

/**
 * One-time startup sequence: run the official readiness/repair check and
 * make sure the daemon is up before the heartbeat loop starts probing it
 * every tick.
 *
 * Provider selection (`okx-a2a ai-provider set`) and OpenClaw plugin
 * config/registration are owned exclusively by
 * scripts/seller-runtime-supervisor.ts, which starts this process only
 * after both are proven — see that file's module docblock for the "exactly
 * one owner" rationale. This process must never call `okx-a2a setup` or
 * `okx-a2a ai-provider set` itself.
 */
async function establishCommunicationReadiness(): Promise<void> {
  const doctor = await runDoctorFix();
  log("communication_ready", {
    ok: doctor.ok,
    pass: doctor.pass,
    warn: doctor.warn,
    fail: doctor.fail,
  });

  const daemonOk = await ensureDaemonRunning();
  log("a2a_daemon_ready", { ok: daemonOk, provider: A2A_PROVIDER });
}

/**
 * Publishes a heartbeat only when the daemon is up AND the official
 * gate-check AND the XMTP client all genuinely pass. Process liveness alone
 * never counts as online.
 */
async function publishHeartbeat(): Promise<void> {
  const daemonOk = await ensureDaemonRunning();
  const [gateOk, xmtpOk] = await Promise.all([officialGateCheckPasses(), xmtpClientActive()]);
  if (xmtpOk) log("xmtp_ready", { ok: true });

  if (!daemonOk || !gateOk || !xmtpOk) {
    consecutiveHeartbeatFailures += 1;
    log("heartbeat_withheld", {
      daemonOk,
      gateOk,
      xmtpOk,
      consecutiveFailures: consecutiveHeartbeatFailures,
      note: "runtime is not provably online; heartbeat intentionally not sent",
    });
    return;
  }

  try {
    const response = await fetch(`${BASE_URL}/api/internal/okx/seller-heartbeat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${HEARTBEAT_SECRET}`,
      },
      body: JSON.stringify({
        aspAgentId: SELLER.agentId,
        a2aServiceId: A2A_SERVICE_ID,
        sellerWallet: SELLER.walletAddress,
        registeredCommunicationAddress: COMMUNICATION_ADDRESS,
        recoveredSignerAddress: COMMUNICATION_ADDRESS,
        // Real values, not literal `true` — this is only reached because the
        // guard above already required all three, but passing the variables
        // keeps the payload honest if that guard is ever refactored.
        onchainOsAuthenticated: gateOk,
        officialWatchActive: daemonOk,
        xmtpClientReady: xmtpOk,
        ttlSeconds: HEARTBEAT_TTL_SECONDS,
      }),
    });
    if (!response.ok) {
      consecutiveHeartbeatFailures += 1;
      log("heartbeat_rejected", {
        status: response.status,
        consecutiveFailures: consecutiveHeartbeatFailures,
      });
      return;
    }
    consecutiveHeartbeatFailures = 0;
    log("heartbeat_accepted", { status: response.status, ttlSeconds: HEARTBEAT_TTL_SECONDS });
  } catch (err) {
    consecutiveHeartbeatFailures += 1;
    log("heartbeat_error", {
      // Message only — never the request, headers, or secret.
      message: err instanceof Error ? err.message : "unknown_error",
      consecutiveFailures: consecutiveHeartbeatFailures,
    });
  }
}

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log("shutdown_started", { signal });
  if (heartbeatTimer) clearInterval(heartbeatTimer);

  const paths = getRuntimePaths(resolveRuntimeRoot(), "seller");
  try {
    // Release the lock so a replacement container can start immediately
    // rather than waiting for stale-PID detection.
    if (fs.existsSync(paths.pidFile)) fs.rmSync(paths.pidFile, { force: true });
  } catch {
    // Best effort — readLivePid recovers a stale lock on next start anyway.
  }
  log("shutdown_complete", { signal });
  process.exit(0);
}

async function main(): Promise<void> {
  const root = resolveRuntimeRoot();
  const paths = getRuntimePaths(root, "seller");
  ensureRuntimeLayout(paths);

  log("startup", {
    runtimeRoot: root,
    baseUrl: BASE_URL,
    a2aProvider: A2A_PROVIDER,
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    heartbeatTtlSeconds: HEARTBEAT_TTL_SECONDS,
    platform: process.platform,
    node: process.version,
  });

  verifyIdentityOrExit();
  acquireSingleInstanceLock(paths.pidFile);

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  await establishCommunicationReadiness();

  await publishHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (shuttingDown) return;
    void publishHeartbeat();
  }, HEARTBEAT_INTERVAL_MS);

  log("running", { note: "foreground supervisor active; awaiting signals" });
}

main().catch((err) => {
  log("fatal", { message: err instanceof Error ? err.message : "unknown_error" });
  process.exit(1);
});
