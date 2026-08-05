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
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { actionLedgerPath, FileActionLedger } from "../src/lib/okx-runtime/action-ledger";
import {
  classifyGateCheckOutcome,
  DEFAULT_GATE_CHECK_LIMITS,
  GateProofState,
} from "../src/lib/okx-runtime/gate-check-proof";
import type { runProcess } from "../src/lib/okx-runtime/process-runner";
import {
  ensureRuntimeLayout,
  getRuntimePaths,
  OKX_RUNTIME_IDENTITIES,
  readLivePid,
  writePid,
} from "../src/lib/okx-runtime/runtime-layout";
import {
  createActionRunner,
  createInstructionFetcher,
  createOpenJobLister,
  createOpenJobTaskReader,
  createReconciler,
  createStatusPublisher,
  createTaskReader,
} from "../src/lib/okx-runtime/system-event-adapters";
import {
  applicationLedgerPath,
  FileApplicationLedger,
} from "../src/lib/okx-runtime/application-ledger";
import {
  reconcileOpenJobs,
  type OpenJobReconcilerDeps,
} from "../src/lib/okx-runtime/open-job-reconciler";
import { parseApplyMode } from "../src/lib/okx-runtime/provider-apply";
import { resolveCleanupGitHubToken } from "../src/lib/github-app/resolve-cleanup-token";
import {
  createDeterministicTurn,
  type DeterministicTurnOptions,
} from "../src/lib/okx-runtime/deterministic-turn";
import {
  LedgerActionStore,
  pendingSystemEvents,
  readSystemEventInbox,
  registerObservedEvent,
  retireSpoolFile,
  systemEventInboxPath,
} from "../src/lib/okx-runtime/system-event-intake";
import {
  handleSystemEvent,
  recoverPendingEvents,
  type ReconcilerDeps,
} from "../src/lib/okx-runtime/system-event-reconciler";
// Deliberately NOT from ./seller-runtime-supervisor: that module's import graph
// reaches `openclaw/plugin-sdk/gateway-runtime`, which needs Node 22+. Reading
// two constants from it would drag the whole Gateway client into this process's
// startup path for no reason.
import { OKX_SYSTEM_EVENT_AGENT_ID } from "../src/lib/okx-runtime/system-event-agent";

const execFileAsync = promisify(execFile);

const SELLER = OKX_RUNTIME_IDENTITIES.seller;
const A2A_SERVICE_ID = "37348";
const COMMUNICATION_ADDRESS = "0x00dbdbb36b71ace0e1fc517056f376f977d8256e";

/**
 * How often the runtime drains the official system-event spool and resumes any
 * unfinished ledger record.
 *
 * This interval is also the effective backoff between retries of a retryable
 * event: the executor bounds the number of attempts (decideRetry's
 * MAX_ATTEMPTS), and this bounds how fast they are spent.
 */
const SYSTEM_EVENT_POLL_MS = Number(process.env.REPODIET_SYSTEM_EVENT_POLL_MS || 60_000);
/**
 * Open-job sweep cadence. Deliberately far slower than the event poll: this
 * is the safety net for events that never arrived, and each pass costs a full
 * `active-tasks` read plus a `status` + `context` read per open job.
 */
const OPEN_JOB_SWEEP_MS = Number(process.env.REPODIET_OPEN_JOB_SWEEP_MS || 300_000);

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
 * === Incident #13: the official gate-check is far slower than the heartbeat
 * tick, so running it inline on every tick can never succeed ===
 *
 * Measured live on repodiet-agent-9636: `onchainos agent gate-check --role
 * asp` completed in ~20s on a quiet runtime, but was still running when
 * killed at a hard 90s bound once the runtime was under its own steady-state
 * load (`DURATION=90s EXIT=124`). It shells out to `okx-a2a doctor`, which
 * makes live OKX backend + XMTP calls, so its latency is genuinely variable
 * — not a hang, just slow.
 *
 * That is structurally incompatible with calling it inline every
 * HEARTBEAT_INTERVAL_MS (60s) under Incident #12's 45s bound:
 *   - a real 60-90s gate-check always exceeds the 45s bound, so `gateOk`
 *     is false on every tick and the heartbeat is withheld forever, even
 *     though the runtime is genuinely healthy (daemonOk/xmtpOk both true);
 *   - `setInterval` fires the next tick regardless of whether the previous
 *     one finished, so slow cycles overlap and pile up concurrent
 *     onchainos/okx-a2a subprocesses contending over the same local state,
 *     which makes each one slower still — a self-reinforcing spiral that
 *     matches the observed "one accepted heartbeat, then permanently
 *     gateOk:false" trace exactly.
 *
 * Fix: separate the two cadences. The heavy gate-check runs on its own
 * background timer with a bound it can actually finish inside, and caches
 * its last SUCCESSFUL result with a timestamp. The 60s heartbeat tick reads
 * that cached proof instead of re-running the command, so it stays fast
 * (only `daemon status` + `agent refresh`, both consistently sub-10s).
 *
 * This does NOT weaken the "never claim online without proof" rule: the
 * heartbeat still requires a real gate-check that genuinely passed, and
 * treats it as valid only while it is fresh. A stale proof fails closed
 * exactly like a failed check. GATE_CHECK_FRESHNESS_MS is deliberately
 * larger than GATE_CHECK_REFRESH_MS so a single slow refresh cannot flap
 * the agent offline, but far short of indefinite.
 */
/**
 * === Incident #14: the gate-check cadence was still far too aggressive for
 * what the command actually costs, so the agent could not hold uptime ===
 *
 * Incident #13 moved the gate-check off the 60s heartbeat tick onto its own
 * 180s timer, which fixed the immediate "withheld forever" symptom. But 20
 * minutes of continuous observation with zero operator contact showed the
 * agent still going offline, with gate-check duration climbing steadily:
 *
 *   16:00:23  22,371ms  pass
 *   16:06:38  14,366ms  pass
 *   16:10:15  51,327ms  pass
 *   16:14:08 104,820ms  pass
 *   16:17:53 150,010ms  FAIL (bound)
 *   16:20:53 150,059ms  FAIL (bound)
 *
 * Two consecutive failures exhausted the 420s freshness window and the
 * agent dropped to offline ~20 minutes after a clean boot.
 *
 * Machine resources were NOT exhausted when this happened (load 2.70, 904MB
 * free, 6 node processes — all better than during an earlier healthy
 * period), so this is not a local leak. `onchainos agent gate-check` shells
 * out to a full `okx-a2a doctor`, whose checks include a live npm-registry
 * version lookup (measured at 29s on its own) plus several OKX-backend and
 * XMTP calls. That cost is externally variable and, on a single shared
 * vCPU, swings between ~14s and past 150s.
 *
 * Running that every 180s means ~20 doctor runs per hour, each capable of
 * outliving its own bound — the agent's online status ends up hostage to
 * the slowest external dependency in an expensive diagnostic command.
 *
 * Fix, without weakening the online claim:
 *   - Run the full gate-check far less often (GATE_CHECK_REFRESH_MS), as
 *     the periodic deep audit it actually is, cutting doctor invocations
 *     ~5x.
 *   - Widen the freshness window to comfortably survive several consecutive
 *     slow or failed refreshes, while still bounding how old a proof may be.
 *   - Persist the proof's timestamp to the runtime volume so a restart does
 *     not discard it and force a cold re-prove during a slow window.
 *
 * The heartbeat still verifies the daemon and the XMTP client live on every
 * single tick — both consistently sub-10s — and still refuses to publish
 * unless a real gate-check genuinely passed within the freshness window. A
 * stale or missing proof fails closed exactly as before; this changes how
 * long a real proof stays valid, never whether one is required.
 */
/**
 * === Incident #15: see gate-check-proof.ts ===
 *
 * Three consecutive 150s timeouts at the 900s cadence is exactly the 2,700s
 * freshness window, so the proof expired and the agent read as offline to OKX
 * for ~10 minutes while `daemonOk`/`xmtpOk` were continuously true. The
 * classification, proof lifetime and retry cadence now live in
 * `GateProofState`, which distinguishes an INCONCLUSIVE timeout (proof
 * stands, retry promptly on bounded backoff) from a CONFIRMED failure (proof
 * dies immediately). Both directions matter: the old code was under-available
 * on timeouts and under-honest on real failures.
 */
const GATE_CHECK_TIMEOUT_MS = DEFAULT_GATE_CHECK_LIMITS.timeoutMs;

/**
 * Runs a command with a timeout that kills the ENTIRE process group, so no
 * grandchild can outlive the deadline.
 *
 * `execFile`'s built-in `timeout` signals only the direct child. Commands that
 * shell out (`onchainos agent gate-check` → `okx-a2a doctor`) therefore leave
 * orphans behind on every timeout. `detached: true` gives the child its own
 * process group (pgid === child.pid) and `kill(-pgid)` takes down that whole
 * tree — the child and everything it spawned.
 *
 * Resolves with stdout on clean exit. On timeout, rejects with `code: "ETIMEDOUT"`
 * so the caller's existing `classifyGateCheckOutcome` still reads it as the
 * inconclusive-timeout case rather than a hard failure.
 */
async function runBoundedGroup(
  command: string,
  args: string[],
  timeoutMs: number
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });

    /** Kills the group, falling back to the bare pid if the group is already gone. */
    const killGroup = (signal: NodeJS.Signals) => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
          /* already exited */
        }
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup("SIGTERM");
      // Escalate for anything ignoring SIGTERM, then stop waiting.
      setTimeout(() => killGroup("SIGKILL"), 5_000).unref();
    }, timeoutMs);

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    child.on("error", (err) => {
      finish(() => reject(err));
    });

    child.on("close", (code) => {
      finish(() => {
        if (timedOut) {
          const err = new Error(`${command} timed out after ${timeoutMs}ms`) as NodeJS.ErrnoException;
          err.code = "ETIMEDOUT";
          reject(err);
          return;
        }
        if (code === 0) {
          resolve({ stdout });
          return;
        }
        const err = new Error(stderr.trim() || `${command} exited with code ${code}`) as NodeJS.ErrnoException;
        err.code = String(code ?? "UNKNOWN");
        reject(err);
      });
    });
  });
}
let gateCheckTimer: NodeJS.Timeout | undefined;
let gateCheckInFlight = false;
let heartbeatCycleInFlight = false;
const gateProof = new GateProofState(DEFAULT_GATE_CHECK_LIMITS);

function gateProofIsFresh(nowMs: number = Date.now()): boolean {
  return gateProof.mayClaimOnline(nowMs);
}

/**
 * The proof timestamp survives a process restart via the runtime volume —
 * a gate-check that genuinely passed four minutes ago is still evidence
 * four minutes later, whether or not this process is the one that ran it.
 * Freshness is re-evaluated against the same bound on read, so a restart
 * can never resurrect an expired proof, and any unreadable/corrupt/
 * future-dated value is discarded rather than trusted.
 */
function gateProofFile(): string {
  return path.join(resolveRuntimeRoot(), "seller-9636", "gate-check-proof.json");
}

function persistGateProof(passedAtMs: number): void {
  try {
    fs.writeFileSync(gateProofFile(), JSON.stringify({ passedAtMs }), "utf8");
  } catch {
    // Best-effort — losing the cache must never break the runtime.
  }
}

function loadPersistedGateProof(): void {
  try {
    const parsed = JSON.parse(fs.readFileSync(gateProofFile(), "utf8"));
    // Absent, future-dated and already-stale values are all rejected inside
    // `restore` — a restart can never resurrect an expired proof.
    if (gateProof.restore(Number(parsed?.passedAtMs))) {
      log("gate_proof_restored", { ageMs: Date.now() - gateProof.lastPassedAtMs });
    }
  } catch {
    // No usable proof — start with none and fail closed until one passes.
  }
}

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

/**
 * === Incident #12: unbounded per-heartbeat-tick CLI calls silently hung the
 * whole heartbeat loop forever ===
 *
 * Live on repodiet-agent-9636 after the Incident #11 fix was verified
 * working (daemon started in ~1s, first heartbeat cycle ran end-to-end and
 * was rejected 401 by the backend — a separate, expected issue). No further
 * heartbeat cycle (accepted, rejected, OR withheld) was logged for 7+
 * minutes afterward despite the 60s interval and the process/daemon both
 * confirmed still alive via direct inspection — i.e. `publishHeartbeat`
 * itself hung mid-call, not the daemon or the process.
 *
 * Root cause: of the five `execFileAsync` calls in this file, only these
 * two — the ones run on EVERY heartbeat tick — pass no `timeout` option.
 * `okx-a2a doctor --fix` (240s), `daemon status` (20s), and `daemon start`
 * (60s) are all bounded; `onchainos agent gate-check` and
 * `okx-a2a agent refresh --json` were not. Both shell out to CLIs known
 * from prior incidents to block indefinitely on a stalled backend/network
 * call (see the `onchainos wallet login --phase poll` hang precedent) with
 * no internal timeout of their own. Once either call stalls, the awaiting
 * `Promise.all` in `publishHeartbeat` never settles, so no heartbeat log
 * line (withheld, rejected, or accepted) is ever produced again — the
 * failure is silent, not a crash, so process supervision never intervenes.
 *
 * Fix: bound both calls, matching this file's existing pattern for every
 * other CLI invocation. A rejected/timed-out promise here already resolves
 * to `false` via the existing catch block, so `publishHeartbeat` correctly
 * withholds that one cycle and tries again on the next tick, instead of
 * hanging forever.
 */
/**
 * Runs the real gate-check and, on success, records when it passed. Called
 * from its own slower timer (see Incident #13 above), never inline from the
 * 60-second heartbeat tick. Self-guards against overlapping runs so a
 * refresh that outlives its own interval can never stack.
 */
async function refreshOfficialGateCheck(): Promise<boolean> {
  if (gateCheckInFlight) {
    log("gate_check_skipped_still_running", {
      note: "previous gate-check has not finished; not stacking another",
    });
    return gateProofIsFresh();
  }
  gateCheckInFlight = true;
  const startedAtMs = Date.now();
  let stdout: string | undefined;
  let error: NodeJS.ErrnoException | undefined;
  try {
    /**
     * `detached: true` puts the child in its own PROCESS GROUP, and the
     * timeout below kills that whole group rather than just the direct child.
     *
     * Why this matters, observed live: `execFileAsync`'s own `timeout` sends
     * a signal to `onchainos` only. But `onchainos agent gate-check` spawns
     * `okx-a2a doctor --json` as a GRANDCHILD, so a timed-out gate-check left
     * that grandchild running, reparented to init (ppid=1). Every subsequent
     * timeout leaked another one. Three had accumulated on the production
     * machine, each holding a Node heap on a 1-vCPU box, which drove load
     * average past 14 and starved the very gate-check that spawned them — a
     * feedback loop where each timeout made the next timeout more likely.
     *
     * Killing the group means a bounded check stays genuinely bounded: no
     * survivors, no accumulation, no starvation spiral.
     */
    ({ stdout } = await runBoundedGroup(
      "onchainos",
      ["agent", "gate-check", "--role", "asp"],
      GATE_CHECK_TIMEOUT_MS
    ));
  } catch (err) {
    error = err as NodeJS.ErrnoException;
  } finally {
    gateCheckInFlight = false;
  }

  const outcome = classifyGateCheckOutcome({
    stdout,
    error,
    durationMs: Date.now() - startedAtMs,
    expectedAgentId: SELLER.agentId,
    timeoutMs: GATE_CHECK_TIMEOUT_MS,
  });
  gateProof.record(outcome);
  if (outcome.kind === "passed") persistGateProof(gateProof.lastPassedAtMs);

  log("gate_check_result", {
    passed: outcome.kind === "passed",
    outcome: outcome.kind,
    reason: outcome.kind === "passed" ? undefined : outcome.reason,
    durationMs: outcome.durationMs,
    health: gateProof.health(),
    nextRefreshMs: gateProof.nextRefreshDelayMs(),
    note:
      outcome.kind === "inconclusive"
        ? "inconclusive (no verdict reached); last successful proof still applies and a retry is scheduled sooner"
        : outcome.kind === "failed"
          ? "gate CONFIRMED not ready; cached proof invalidated immediately, heartbeat withheld from the next tick"
          : undefined,
  });
  // Reschedule from the outcome so an inconclusive run is retried well inside
  // the freshness window instead of waiting a full normal refresh interval.
  scheduleNextGateCheck();
  return outcome.kind === "passed";
}

/**
 * Single-shot timer, re-armed after every refresh. `setTimeout` rather than
 * `setInterval` so the delay can vary with the last outcome, and so a slow
 * refresh can never stack a second one behind it.
 */
function scheduleNextGateCheck(): void {
  if (shuttingDown) return;
  if (gateCheckTimer) clearTimeout(gateCheckTimer);
  gateCheckTimer = setTimeout(() => {
    if (shuttingDown) return;
    void refreshOfficialGateCheck();
  }, gateProof.nextRefreshDelayMs());
  // Never keep the process alive purely to run a diagnostic.
  gateCheckTimer.unref?.();
}

async function xmtpClientActive(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("okx-a2a", ["agent", "refresh", "--json"], {
      timeout: 45_000,
    });
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
 * === Incident #11: `okx-a2a`'s own "OS autostart" mechanism is fundamentally
 * incompatible with this container and, once triggered, permanently breaks
 * every future `daemon start` attempt ===
 *
 * Traced directly from the real pinned `@okxweb3/a2a-node@0.1.11` CLI
 * source (not assumed). Two independent, unrelated code paths both delegate
 * to it:
 *
 *   1. `okx-a2a doctor --fix`'s own "autostart" check has `fix.kind: "auto"`
 *      — every doctor --fix run at boot, on a fresh volume, silently
 *      attempts to install a systemd user unit
 *      (`~/.config/systemd/user/okx-a2a.service`) and run
 *      `systemctl --user enable --now`. This container (Dockerfile.seller,
 *      `node:22-bookworm-slim`, tini + this supervisor as the only process
 *      supervision — see Incident #1's "systemctl --user, which does not
 *      exist here" note elsewhere in this repo) has no systemd/D-Bus user
 *      session. Each `systemctl --user ...` call carries its own internal
 *      30-second timeout (traced: `execFileAsync("systemctl", [...], {
 *      timeout: 30_000 })`) and hangs for the full duration rather than
 *      failing fast.
 *   2. The unit FILE is written (`writeFile(servicePath, ...)`) *before*
 *      `systemctl` is ever invoked, so it persists on the volume regardless
 *      of whether systemctl succeeds, fails, or times out. From that point
 *      on, `isAutostartInstalled()` (a bare `fs.existsSync` check) returns
 *      true forever, and both `okx-a2a daemon start`'s own "restart via
 *      supervisor" fallback *and* doctor's own separate `daemon_running`
 *      auto-fix (`ensureDaemonReady` -> `startDaemonRespectingSupervisor`)
 *      unconditionally route through `systemctl --user restart ...` next —
 *      the exact same hang, now on every single future attempt, including
 *      once per heartbeat tick via `ensureDaemonRunning` below. Live on
 *      repodiet-agent-9636: this produced multi-minute heartbeat cycles,
 *      100% reproducible across independent reboots, and accelerating
 *      memory pressure (OOM at ~26 minutes on 2GB vs ~65 minutes on 1GB)
 *      from the repeated timed-out subprocess spawns.
 *
 * Fix, two parts:
 *   - `okx-a2a daemon start` has a documented `--no-autostart` flag whose
 *     CLI handler (`handleStart`) skips the autostart branch entirely based
 *     purely on that flag — never checking file state — so it always takes
 *     the fast, bounded, plain `startDaemon()` path. Always passed below;
 *     this alone eliminates the recurring, unbounded, per-heartbeat-tick
 *     risk entirely.
 *   - `okx-a2a doctor --fix`'s own internal `daemon_running` auto-fix has
 *     no equivalent flag (`ensureDaemonReady` is called as a library
 *     function, never through CLI arg parsing) — the only lever available
 *     is keeping the unit file absent so `isAutostartInstalled()` stays
 *     false. `disableOkxA2aOsAutostart()` proactively removes it
 *     immediately before and after the one-time doctor --fix call this
 *     process makes at startup, bounding (not eliminating — doctor's own
 *     "autostart" check will still attempt one ~60s install/hang per fresh
 *     boot before this function's post-call cleanup runs) the one-time
 *     startup cost to the existing generous timeout below, while
 *     guaranteeing the file never persists to poison later calls.
 */
function disableOkxA2aOsAutostart(): void {
  const platformPaths =
    process.platform === "darwin"
      ? [path.join(os.homedir(), "Library", "LaunchAgents", "com.okx.a2a.plist")]
      : [path.join(os.homedir(), ".config", "systemd", "user", "okx-a2a.service")];
  for (const unitPath of platformPaths) {
    try {
      fs.rmSync(unitPath, { force: true });
    } catch {
      // Best-effort — must never block startup over a diagnostic cleanup.
    }
  }
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
  disableOkxA2aOsAutostart();
  try {
    return await runDoctorFixOnce();
  } finally {
    // See Incident #11 above: doctor's own "autostart" auto-fix (and, if
    // that already left the unit file behind, its separate daemon_running
    // auto-fix too) may have just recreated the poisoning unit file during
    // the call above — removed again here so it never persists past this
    // one bounded, one-time startup cost.
    disableOkxA2aOsAutostart();
  }
}

async function runDoctorFixOnce(): Promise<DoctorResult> {
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
 *
 * `--no-autostart` is required, not optional — see Incident #11 above.
 * Traced directly into the real CLI's `handleStart` (the `daemon start`
 * command handler): without this flag, EVERY call unconditionally attempts
 * to install/restart an OS-level (systemd) autostart service first, which
 * hangs for ~30-60s per attempt in this systemd-less container and, once
 * it leaves its unit file behind, permanently routes every subsequent call
 * through the same broken path — exactly the failure this once-per-
 * heartbeat-tick call would otherwise reproduce forever.
 */
async function ensureDaemonRunning(): Promise<boolean> {
  if (await daemonIsRunning()) return true;
  disableOkxA2aOsAutostart();
  try {
    // Verified against the real `okx-a2a daemon --help`: `daemon start`
    // documents only [--provider] [--ai-provider] [--no-autostart] — no
    // --json. Success is confirmed below via the documented `daemon status`
    // check rather than by parsing start's own output.
    await execFileAsync(
      "okx-a2a",
      ["daemon", "start", "--provider", A2A_PROVIDER, "--no-autostart"],
      { timeout: 60_000 }
    );
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
  // Incident #13: the gate-check runs on its own slower timer; this tick
  // reads the proof it recorded rather than re-running a command that can
  // outlive the tick interval.
  const gateOk = gateProofIsFresh();
  const xmtpOk = await xmtpClientActive();
  if (xmtpOk) log("xmtp_ready", { ok: true });

  if (!daemonOk || !gateOk || !xmtpOk) {
    consecutiveHeartbeatFailures += 1;
    log("heartbeat_withheld", {
      daemonOk,
      gateOk,
      xmtpOk,
      // Distinguishes "the gate said no" from "the gate never answered" —
      // the two used to be indistinguishable in the logs, which is what made
      // Incident #15 take a full observation window to diagnose.
      gateHealth: gateProof.health(),
      gateReason: gateProof.reason(),
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

/**
 * === The OKX system-event route's production call site ===
 *
 * The audited defect had two layers, and this is the fix for the second one.
 * The first was that the old worker acknowledged an event whenever
 * `onchainos agent next-action` exited 0 — but next-action exiting 0 only means
 * the CLI printed an instruction, not that anyone carried it out. The second,
 * worse layer: that function had NO production caller at all. It was reachable
 * only from tests, so in production `next-action` never ran even once, and the
 * official lifecycle never advanced.
 *
 * Everything below exists so that is no longer true. The executor
 * (provider-event-executor) is reached from exactly two triggers, both here,
 * both funnelling through the same code so neither can bypass the authorization
 * boundary, the durable ledger or the idempotency rules:
 *
 *   - startup recovery, from the ledger's own stored envelopes;
 *   - the durable inbox spool, for newly received official events.
 *
 * The model is reached only from inside that executor, only for an envelope
 * that structurally proved itself to be an official system event, and only as
 * the isolated `okx-system-events` agent. Ordinary buyer chat never enters this
 * path — it is owned end-to-end by the deterministic repodiet-a2a-bridge and
 * never touches these functions.
 */
let systemEventTimer: NodeJS.Timeout | undefined;
let systemEventCycleInFlight = false;
let openJobTimer: NodeJS.Timeout | undefined;
let openJobSweepInFlight = false;

/**
 * Builds the real, CLI-backed dependency set. Every adapter here shells out
 * through argv arrays (never an interpolated string, never `shell: true`), and
 * the ledger is the crash-safe one on the mounted volume, so evidence survives
 * a Machine restart or an image redeploy.
 */
export function buildSystemEventDeps(
  dataDirectory: string,
  env: NodeJS.ProcessEnv = process.env,
  /**
   * Process seam. Production always uses the default (the real argv-array
   * runner); tests inject a fake so the genuine dependency construction and the
   * genuine cycle can be exercised without invoking the official CLIs.
   */
  runner?: typeof runProcess,
  /**
   * Pipeline/GitHub seams for the steps the deterministic turn cannot fake
   * with a process runner: resolving a real GitHub App token, checking for
   * (and reusing) an already-open cleanup PR for this exact job before ever
   * creating a new one, and preparing the actual cleanup deliverable.
   * Production always uses the real implementations (the same ones the ASP
   * job executor and the paid A2MCP tools use); tests inject fakes so
   * `job_accepted`'s full path — including its duplicate-PR guard — can be
   * exercised without cloning a real repository or calling GitHub.
   */
  testSeams?: Pick<
    DeterministicTurnOptions,
    "createCleanupPr" | "resolveGitHubToken" | "createGitHubClient" | "refetchInstruction"
  >
): ReconcilerDeps & { ledgerFile: FileActionLedger } {
  const ledgerFile = new FileActionLedger(actionLedgerPath(dataDirectory), SELLER.agentId);
  const adapterOptions = {
    agentId: SELLER.agentId,
    systemEventAgentId: OKX_SYSTEM_EVENT_AGENT_ID,
    env,
    runner,
  };

  const readTask = createTaskReader(adapterOptions);
  const fetchInstruction = createInstructionFetcher(adapterOptions);

  return {
    ledgerFile,
    ledger: new LedgerActionStore(ledgerFile),
    fetchInstruction,
    readTask,
    // Deterministic, not model-backed — see deterministic-turn.ts. The
    // mandatory OKX protocol path (acknowledge / apply / accept / deliver)
    // must not depend on a rate-limited, quota-capped third-party LLM.
    // `refetchInstruction` is the SAME fetcher the executor uses, so a
    // `wakeup_notify` redirect re-requests its real playbook through the
    // identical authenticated path — never a second, divergent code path.
    runModel: createDeterministicTurn({
      ...adapterOptions,
      readTask,
      refetchInstruction: fetchInstruction,
      ...testSeams,
    }),
    runAction: createActionRunner(adapterOptions),
    reconcile: createReconciler(adapterOptions),
    // The buyer is resolved from authoritative task detail inside the adapter.
    // This runtime never carries the buyer identity: it is the one process that
    // must never be able to act as the client.
    publishStatus: createStatusPublisher(adapterOptions),
    // Rebuilt from the ORIGINAL validated envelope each record stored, and
    // re-validated on the way out — a record whose envelope is missing,
    // malformed, oversized or not provably ours is skipped rather than run.
    pending: () => pendingSystemEvents(ledgerFile, log),
    log,
  };
}

/**
 * Drains the spool into the ledger, then executes.
 *
 * The ledger write happens BEFORE the spool file is retired and before any work
 * is attempted, so an event can never be consumed without a durable record of
 * it. A crash anywhere after that leaves the event resumable rather than lost.
 */
export async function runSystemEventCycle(
  deps: ReconcilerDeps & { ledgerFile: FileActionLedger },
  inboxDirectory: string
): Promise<void> {
  for (const spooled of readSystemEventInbox(inboxDirectory)) {
    const outcome = registerObservedEvent(deps.ledgerFile, spooled.raw, {
      transportId: spooled.transportId,
      log,
    });

    if (!outcome.accepted) {
      // Never executed, never acknowledged — moved aside for inspection.
      retireSpoolFile(spooled.file, "rejected");
      continue;
    }

    // Durable now; the ledger owns this event from here on.
    retireSpoolFile(spooled.file, "accepted");
    await handleSystemEvent(outcome.eventId, outcome.envelope, deps);
  }

  // Resumes anything still unfinished — a retryable failure, an action
  // broadcast whose outcome was never confirmed, or a turn whose XMTP status
  // never published. Reconciles before retrying; never re-runs a completed
  // action.
  await recoverPendingEvents(deps);
}

/**
 * Sweeps OPEN jobs designated to this provider and applies for the eligible
 * ones.
 *
 * The event path above only fires when an event actually arrives. A
 * `job_asp_selected` that was never delivered — or that arrived while the
 * machine was down — leaves a real job at `created` with no event to replay,
 * which is exactly the state seven live jobs were found in. This sweep reads
 * authoritative OKX state directly and closes that gap.
 *
 * Failures are contained: a sweep that throws must never take down the event
 * cycle it shares a tick with.
 */
export function buildOpenJobDeps(
  dataDirectory: string,
  env: NodeJS.ProcessEnv = process.env,
  runner?: typeof runProcess
): OpenJobReconcilerDeps {
  const adapterOptions = {
    agentId: SELLER.agentId,
    systemEventAgentId: OKX_SYSTEM_EVENT_AGENT_ID,
    env,
    runner,
  };
  const ledger = new FileApplicationLedger(
    applicationLedgerPath(dataDirectory),
    SELLER.agentId
  );
  const runAction = createActionRunner(adapterOptions);

  return {
    mode: parseApplyMode(env.REPODIET_PROVIDER_APPLY_MODE),
    listOpenJobs: createOpenJobLister(adapterOptions),
    readTask: createOpenJobTaskReader(adapterOptions),
    /**
     * Repository existence probe.
     *
     * Unauthenticated by intent — the question is "can this repository be
     * reached at all", and answering it with our own credentials would
     * confuse "public" with "we happen to have access".
     *
     * But GitHub's unauthenticated quota is 60/hour PER IP, and Fly egress
     * addresses are shared. Measured live on this machine:
     * `x-ratelimit-limit: 60, x-ratelimit-remaining: 0`, so every probe
     * returned 403 for a repository that exists and is public. A quota
     * refusal is reported explicitly so `verifyRepositoryForApply` can treat
     * it as INCONCLUSIVE rather than as "you may not see this" — otherwise
     * the apply path refuses every legitimate job while looking healthy.
     *
     * Bounded so a hanging request cannot stall the sweep.
     */
    repositoryProbe: {
      publicLookup: async (owner, repo) => {
        const response = await fetch(
          `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
          {
            method: "GET",
            headers: { accept: "application/vnd.github+json", "user-agent": "repodiet-9636" },
            signal: AbortSignal.timeout(20_000),
          }
        );
        // GitHub signals quota exhaustion with remaining=0 (403), and
        // secondary/abuse limits with retry-after on 403/429.
        const remaining = response.headers.get("x-ratelimit-remaining");
        const rateLimited =
          (response.status === 403 || response.status === 429) &&
          (remaining === "0" || response.headers.has("retry-after"));
        return { status: response.status, rateLimited };
      },
      /**
       * Resolves the 404 ambiguity — and, critically, gives a quota-independent
       * answer when the unauthenticated probe is throttled. An installation
       * token is scoped to a repository we can actually work on, which is the
       * question that ultimately matters.
       */
      hasInstallationAccess: async (owner, repo) => {
        try {
          await resolveCleanupGitHubToken({
            repoUrl: `https://github.com/${owner}/${repo}`,
            owner,
            repo,
          });
          return true;
        } catch {
          return false;
        }
      },
    },
    /**
     * Asks the buyer to authorize a repository we cannot read, over the
     * official A2A channel. This is the protocol-correct alternative to
     * applying blindly, and it is what turns an unreachable private repo from
     * a dead end into a resumable negotiation.
     */
    requestAuthorization: async ({ jobId, buyerAgentId, message }) => {
      const result = await runAction({
        command: "okx-a2a xmtp-send",
        args: ["--job-id", jobId, "--to-agent-id", buyerAgentId, "--message", message],
      });
      if (!result.ok) throw new Error(result.error ?? "authorization_request_failed");
    },
    getPriorApplication: (key) => ledger.get(key),
    recordApplication: (key, record) => ledger.put(key, record),
    runAction: async (action) => {
      const result = await runAction(action);
      return {
        ok: result.ok,
        transactionRef: result.transactionRef,
        stderr: result.error,
        // `broadcast` on a FAILED action is the adapter's own signal that the
        // transaction may already be signed and in flight (a timeout, or
        // stdout mentioning broadcast/submitted/pending). That is genuinely
        // ambiguous and must never be reported as a clean failure, which
        // would licence a retry.
        uncertain: !result.ok && result.broadcast,
      };
    },
    log,
  };
}

export async function runOpenJobSweep(deps: OpenJobReconcilerDeps): Promise<void> {
  try {
    await reconcileOpenJobs(deps);
  } catch (err) {
    log("open_job_sweep_error", {
      message: err instanceof Error ? err.message : "unknown_error",
      note: "sweep failed; event processing is unaffected and the next sweep retries",
    });
  }
}

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log("shutdown_started", { signal });
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (gateCheckTimer) clearTimeout(gateCheckTimer);
  if (openJobTimer) clearInterval(openJobTimer);
  if (systemEventTimer) clearInterval(systemEventTimer);

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

  // Incident #13: establish a real gate-check proof before the first
  // heartbeat, then keep it refreshed on its own slower cadence so the
  // 60-second tick never blocks on a command that can outlive it.
  // Incident #14: a still-fresh proof persisted by a previous process is
  // reused, so a restart does not have to re-prove from cold while the
  // command happens to be slow. Only skips the blocking initial run when
  // the restored proof is genuinely still within the freshness bound.
  loadPersistedGateProof();
  if (!gateProofIsFresh()) {
    // `refreshOfficialGateCheck` arms the next timer itself from the outcome.
    await refreshOfficialGateCheck();
  } else {
    scheduleNextGateCheck();
  }

  // Communication readiness is established, so the official CLIs this route
  // shells out to are usable. Resume every unfinished system event from the
  // durable ledger BEFORE accepting new ones: an event left mid-flight by a
  // restart is older work than anything now arriving, and resuming it first is
  // what makes "no duplicate transaction, delivery or settlement" hold across
  // process death.
  const systemEventDeps = buildSystemEventDeps(paths.data);
  const systemEventInbox = systemEventInboxPath(paths.data);
  fs.mkdirSync(systemEventInbox, { recursive: true });
  log("system_event_route_wired", {
    ledger: actionLedgerPath(paths.data),
    inbox: systemEventInbox,
    systemEventAgentId: OKX_SYSTEM_EVENT_AGENT_ID,
    pollMs: SYSTEM_EVENT_POLL_MS,
  });

  await recoverPendingEvents(systemEventDeps);

  systemEventTimer = setInterval(() => {
    if (shuttingDown) return;
    if (systemEventCycleInFlight) {
      log("system_event_cycle_skipped_still_running", {
        note: "previous system-event cycle has not finished; not stacking another",
      });
      return;
    }
    systemEventCycleInFlight = true;
    void runSystemEventCycle(systemEventDeps, systemEventInbox)
      .catch((err) => {
        log("system_event_cycle_error", {
          message: err instanceof Error ? err.message : "unknown_error",
        });
      })
      .finally(() => {
        systemEventCycleInFlight = false;
      });
  }, SYSTEM_EVENT_POLL_MS);

  // Open-job sweep. Runs on its own slower timer than the event cycle: it is
  // a safety net for events that never arrived, not the primary path, and it
  // costs a full `active-tasks` + per-job `status`/`context` read each pass.
  const openJobDeps = buildOpenJobDeps(paths.data);
  log("open_job_reconciler_wired", {
    mode: openJobDeps.mode,
    ledger: applicationLedgerPath(paths.data),
    sweepMs: OPEN_JOB_SWEEP_MS,
    note:
      openJobDeps.mode === "live"
        ? "eligible open jobs WILL be applied for on-chain"
        : "observing only; no application will be broadcast",
  });
  await runOpenJobSweep(openJobDeps);
  openJobTimer = setInterval(() => {
    if (shuttingDown) return;
    if (openJobSweepInFlight) return;
    openJobSweepInFlight = true;
    void runOpenJobSweep(openJobDeps).finally(() => {
      openJobSweepInFlight = false;
    });
  }, OPEN_JOB_SWEEP_MS);

  await publishHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (shuttingDown) return;
    if (heartbeatCycleInFlight) {
      log("heartbeat_cycle_skipped_still_running", {
        note: "previous heartbeat cycle has not finished; not stacking another",
      });
      return;
    }
    heartbeatCycleInFlight = true;
    void publishHeartbeat().finally(() => {
      heartbeatCycleInFlight = false;
    });
  }, HEARTBEAT_INTERVAL_MS);

  log("running", { note: "foreground supervisor active; awaiting signals" });
}

// Guarded so the wiring above (buildSystemEventDeps, runSystemEventCycle) can
// be imported and asserted against directly, without starting a second seller
// runtime as an import side effect. Under the container entrypoint this file is
// still the main module, so production behaviour is unchanged.
if (require.main === module) {
  main().catch((err) => {
    log("fatal", { message: err instanceof Error ? err.message : "unknown_error" });
    process.exit(1);
  });
}
