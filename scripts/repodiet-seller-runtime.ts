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

/**
 * Publishes a heartbeat only when the official gate-check AND the XMTP
 * client both genuinely pass. Process liveness alone never counts as online.
 */
async function publishHeartbeat(): Promise<void> {
  const [gateOk, xmtpOk] = await Promise.all([officialGateCheckPasses(), xmtpClientActive()]);

  if (!gateOk || !xmtpOk) {
    consecutiveHeartbeatFailures += 1;
    log("heartbeat_withheld", {
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
        onchainOsAuthenticated: true,
        officialWatchActive: true,
        xmtpClientReady: true,
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
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    heartbeatTtlSeconds: HEARTBEAT_TTL_SECONDS,
    platform: process.platform,
    node: process.version,
  });

  verifyIdentityOrExit();
  acquireSingleInstanceLock(paths.pidFile);

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

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
