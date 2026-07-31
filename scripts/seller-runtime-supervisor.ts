#!/usr/bin/env tsx
/**
 * Container process supervisor for the RepoDiet seller runtime (Agent 9636).
 *
 * This is the Dockerfile.seller CMD. It owns everything scripts/repodiet-
 * seller-runtime.ts could not own by itself: the OpenClaw Gateway process,
 * the OpenClaw config bootstrap, and (as of this revision) the okx-a2a AI
 * provider selection.
 *
 * === Incident #1 (fixed in an earlier revision): unsupervised Gateway ===
 * The container started exactly one foreground process and left the
 * OpenClaw Gateway unsupervised — `okx-a2a setup openclaw`'s own
 * post-install restart shells out to `systemctl --user`, absent under
 * this container's tini PID 1 — so the Gateway never actually started.
 * Fixed by starting `openclaw gateway run` ourselves as a managed
 * foreground child (see startup order below).
 *
 * === Incident #2 (this revision): boot-time network dependency ===
 * The fix for incident #1 still called `okx-a2a setup openclaw --release
 * latest --json` once at every boot to register the OpenClaw gateway
 * plugin. Verified by direct reproduction (both in a local sandbox and on
 * live Fly infrastructure — not merely suspected): that command (a)
 * resolves "latest" fresh on every boot, and when a newer @okxweb3/a2a-node
 * release appeared on npm after this image pinned 0.1.10, silently
 * attempted `npm install -g @okxweb3/a2a-node@latest` inside the running
 * container — which hung well past any reasonable boot timeout on both a
 * bandwidth-constrained sandbox and Fly's own infrastructure; and (b)
 * always ran `openclaw plugins install <spec> --force` (an unconditional
 * network fetch) whenever the gateway plugin was not yet installed, true
 * on every fresh /persistent volume. A concurrent live diagnostic
 * SSH session compounded this by racing the supervisor's own config
 * writes against the same persisted openclaw.json, and the resulting
 * write conflict then made EVERY subsequent restart fail at the very
 * first `config set` call — a self-perpetuating failure with no
 * self-healing path, because every restart just replayed the same writes
 * against the same broken file. See docs/SELLER_RUNTIME_DEPLOYMENT.md for
 * the full incident writeup with real log excerpts.
 *
 * Fix, in full:
 *   - @okxweb3/a2a-openclaw (the gateway plugin) is now pinned, checksum-
 *     verified, and extracted into the image at BUILD time
 *     (Dockerfile.seller), exactly like openclaw-plugins/repodiet-a2a-bridge,
 *     and loaded at boot via `plugins.load.paths` — never installed over
 *     the network at boot.
 *   - The broad `okx-a2a setup openclaw --release latest` command is never
 *     called at runtime. In its place, this supervisor performs the exact
 *     same OpenClaw config normalization that command's own
 *     `ensureOpenClawOkxA2aPluginConfig()` performs internally — traced
 *     directly from the installed @okxweb3/a2a-node@0.1.10 bundle, not
 *     guessed: `session.dmScope`, `plugins.allow`, and
 *     `plugins.entries.okx-a2a.hooks.allowConversationAccess` — via plain
 *     `openclaw config set`, a pure local operation with no network
 *     dependency.
 *   - AI provider selection (which provider the okx-a2a daemon uses) is
 *     now set via the CLI's own minimal, documented, local command —
 *     `okx-a2a ai-provider set --provider <provider> --json` ("Set the
 *     default provider", confirmed via `okx-a2a ai-provider --help` and
 *     its real implementation: a PATH check plus a write to a local
 *     SQLite session store, no network) — instead of the broad `setup`
 *     command. This supervisor is now the SOLE owner of provider
 *     selection; scripts/repodiet-seller-runtime.ts no longer calls
 *     `okx-a2a setup` at all (see that file for its remaining, narrower
 *     responsibilities: `doctor --fix` and daemon start/status).
 *   - Every OpenClaw config write is now guarded by an exclusive bootstrap
 *     lock, validated before and after, and — if the persisted
 *     openclaw.json is missing/empty/truncated/invalid — the damaged file
 *     is quarantined (renamed, never deleted) and a fresh one is rebuilt
 *     from the same pinned config-set sequence. See
 *     src/lib/okx-runtime/openclaw-bootstrap.ts.
 *   - A version-aware bootstrap marker means a healthy, unchanged restart
 *     skips the config-set sequence entirely (pure validation instead) —
 *     bootstrap only reruns when a pinned version changes, the marker is
 *     missing/stale, required plugin files are missing, the config is
 *     invalid, or plugin activation verification fails.
 *
 * === Startup order (each step is a hard prerequisite for the next) ===
 *   1. Verify OPENCLAW_GATEWAY_TOKEN is configured (fail closed otherwise).
 *   2. Acquire the exclusive bootstrap lock.
 *   3. Validate the persisted openclaw.json; quarantine + note rebuild if
 *      invalid.
 *   4. If the bootstrap marker matches the current pinned versions/plugin
 *      ids/config schema AND the config is valid: skip the config-set
 *      sequence (already bootstrapped by a prior successful boot).
 *      Otherwise, run the batched config-set call (see
 *      buildOpenclawConfigBatch) plus `okx-a2a ai-provider set`, then
 *      validate again and write a fresh marker only on full success.
 *   5. Release the bootstrap lock (always, success or failure).
 *   6. Start `openclaw gateway run` as a managed foreground child.
 *   7. Poll until the Gateway is live (`GET /health`) AND authenticated
 *      (`GET /ready`, bearer token attached) — both against the Gateway's
 *      own HTTP server, not the CLI's RPC transport. See Incident #7.
 *   8. Verify BOTH okx-a2a and repodiet-a2a-bridge are genuinely loaded and
 *      active (`openclaw plugins inspect <id> --runtime --json`) — a
 *      plugin file existing on disk is never accepted as proof.
 *   9. Only then start scripts/repodiet-seller-runtime.ts.
 *
 * A second, independently-discovered fix from the earlier revision still
 * applies: the `okx-a2a` daemon/CLI reads its OWN gateway credentials from
 * `OKX_A2A_OPENCLAW_GATEWAY_TOKEN` — a different variable name from
 * `OPENCLAW_GATEWAY_TOKEN` — falling back to a "synced" config file the
 * plugin writes only after connecting successfully. This supervisor sets
 * both names from the one staged secret.
 *
 * Fails closed throughout: any required step that does not genuinely
 * succeed stops the container with a non-zero exit rather than starting
 * the seller runtime in a state that could report false readiness. Never
 * logs a secret value — every command-failure diagnostic is redacted
 * (src/lib/okx-runtime/command-diagnostics.ts).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { runProcess, redactProcessOutput, type ProcessRunResult } from "../src/lib/okx-runtime/process-runner";
import { parsePluginInspection } from "../src/lib/okx-runtime/plugin-inspection";
import { buildCommandFailureDiagnostics } from "../src/lib/okx-runtime/command-diagnostics";
import {
  acquireBootstrapLock,
  bootstrapLockPath,
  bootstrapMarkerMatches,
  bootstrapMarkerPath,
  computeConfigSchemaHash,
  openclawConfigPath,
  quarantineInvalidConfig,
  readBootstrapMarker,
  releaseBootstrapLock,
  validateOpenclawConfigFile,
  writeBootstrapMarker,
  type BootstrapVersions,
} from "../src/lib/okx-runtime/openclaw-bootstrap";

export const OPENCLAW_GATEWAY_PORT = Number(process.env.OPENCLAW_GATEWAY_PORT || 18789);
export const OPENCLAW_GATEWAY_URL = `ws://127.0.0.1:${OPENCLAW_GATEWAY_PORT}`;
// Matches openclaw-plugins/okx-a2a-openclaw/openclaw.plugin.json's "id"
// (the extracted @okxweb3/a2a-openclaw package) — confirmed directly from
// the real published package, not guessed.
export const OKX_A2A_PLUGIN_ID = "okx-a2a";
export const OKX_A2A_PLUGIN_HOOK = "before_agent_run";
// Matches Dockerfile.seller's WORKDIR (/app) + the pinned build-time
// extraction of @okxweb3/a2a-openclaw.
export const OKX_A2A_OPENCLAW_PLUGIN_PATH = "/app/openclaw-plugins/okx-a2a-openclaw";
// Matches openclaw-plugins/repodiet-a2a-bridge/openclaw.plugin.json's "id".
export const REPODIET_BRIDGE_PLUGIN_ID = "repodiet-a2a-bridge";
export const REPODIET_BRIDGE_PLUGIN_HOOK = "before_agent_reply";
// Matches Dockerfile.seller's WORKDIR (/app) + COPY of openclaw-plugins/.
export const REPODIET_BRIDGE_PLUGIN_PATH = "/app/openclaw-plugins/repodiet-a2a-bridge";

// Pinned component versions. Must match Dockerfile.seller's ARG defaults
// exactly (test/seller-runtime-supervisor.test.ts asserts this) — these
// are the values the bootstrap marker is keyed on, so a version bump in
// the Dockerfile without a matching bump here would silently make the
// marker never invalidate.
export const ONCHAINOS_VERSION = "4.4.1";
export const OKX_A2A_VERSION = "0.1.10";
export const OPENCLAW_VERSION = "2026.7.1-2";
export const OKX_A2A_OPENCLAW_PLUGIN_VERSION = "0.1.10";

/**
 * === Incident #6 (previous revision, superseded below): raised these
 * timeouts from 10s/15s to 60s/60s on the theory that `openclaw gateway
 * health`/`gateway status --require-rpc` were cold-start-bound CLI
 * subprocess spawns, the same cost already measured for `openclaw config
 * set` (Incident #4). That theory was wrong: live on repodiet-agent-9636,
 * every poll still timed out at the full 60s, and a direct, bounded
 * 120-second SSH probe (`timeout 120 openclaw gateway health ...`)
 * produced zero stdout/stderr and was killed by the shell's own timeout —
 * not a slow cold start, an indefinite hang.
 *
 * === Incident #7: the CLI's RPC transport hangs; stopped depending on it ===
 * Traced directly into the real `openclaw` 2026.7.1-2 source
 * (call-Bj6Erfmh.js / call-DE3i_Hr1.js): both `gateway health` and
 * `gateway status --require-rpc` funnel through the same `callGateway` ->
 * `callGatewayCli` -> `callGatewayWithScopes` RPC client, which does carry
 * its own internal `setTimeout`-based safety net (`resolveGatewayCallTimeout`)
 * — yet that safety net never fired either on the live Machine, meaning
 * whatever is wrong sits below the RPC layer. Root cause not conclusively
 * pinned down inside third-party minified code after a genuine attempt;
 * further static tracing hit diminishing returns.
 *
 * The same source also confirms the Gateway's own HTTP server
 * (server-http.ts), bound to the identical `--port`, serves plain
 * `GET /health` ("live") and `GET /ready` ("ready", backed by a real
 * `createReadinessChecker` reflecting startup-pending/draining/channel
 * health, not just "process started") — an entirely different code path
 * from the one that hangs. `gatewayHealthy`/`gatewayAuthenticatedAndReady`
 * below now call that HTTP server directly via `fetch()`, in-process, with
 * no subprocess and no dependency on the CLI's RPC client at all. These
 * two constants are now HTTP request timeouts rather than subprocess
 * timeouts, but kept at the same names/values/env-var overrides since the
 * "how long is one probe attempt allowed to take" question is unchanged.
 *
 * `verifyPluginActive` (`openclaw plugins inspect <id> --runtime --json`)
 * is deliberately left calling the CLI: traced into
 * plugins-inspect-command-DRp1IKYf.js, `--runtime` mode performs a purely
 * local "runtime plugin registry load" inside the CLI's own process — it
 * never calls `callGateway`, so it does not share this bug.
 *
 * See docs/SELLER_RUNTIME_DEPLOYMENT.md ("Incident #6" and "Incident #7")
 * for the full writeups with real diagnostic evidence.
 */
const GATEWAY_READY_TIMEOUT_MS = Number(
  process.env.REPODIET_OPENCLAW_GATEWAY_READY_TIMEOUT_MS || 300_000
);
const GATEWAY_READY_POLL_MS = Number(process.env.REPODIET_OPENCLAW_GATEWAY_READY_POLL_MS || 3_000);
const GATEWAY_HEALTH_PROBE_TIMEOUT_MS = Number(
  process.env.REPODIET_OPENCLAW_GATEWAY_HEALTH_PROBE_TIMEOUT_MS || 60_000
);
const GATEWAY_AUTH_PROBE_TIMEOUT_MS = Number(
  process.env.REPODIET_OPENCLAW_GATEWAY_AUTH_PROBE_TIMEOUT_MS || 60_000
);
const CHILD_SHUTDOWN_GRACE_MS = 15_000;

type LogFields = Record<string, unknown>;

function log(event: string, fields: LogFields = {}): void {
  // Structured, single-line, secret-free — same convention as
  // repodiet-seller-runtime.ts. Callers below only ever pass booleans,
  // counts, paths, and CLI exit status — never process output or env values.
  console.log(JSON.stringify({ at: new Date().toISOString(), component: "supervisor", event, ...fields }));
}

/** Logs a command failure with full, redacted, categorized diagnostics — see src/lib/okx-runtime/command-diagnostics.ts. */
function logCommandFailure(
  event: string,
  command: string,
  result: ProcessRunResult,
  durationMs: number,
  retryDecision: "will_retry" | "fatal" | "no_retry_configured"
): void {
  log(event, { ...buildCommandFailureDiagnostics(command, result, durationMs, retryDecision) });
}

/**
 * Builds the environment for every supervised child and CLI probe.
 *
 * Fails closed (returns null) when OPENCLAW_GATEWAY_TOKEN is absent or too
 * short to be a real secret — the Gateway and its clients must never start
 * in an unauthenticated ("none" mode) or guessable-token state.
 *
 * Mirrors the token into OKX_A2A_OPENCLAW_GATEWAY_TOKEN — the separate
 * env var name the okx-a2a daemon/CLI itself reads (see module docblock) —
 * so the daemon does not depend on the plugin's own connection succeeding
 * first to learn the token via its synced-config fallback.
 */
export function buildSupervisorEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv | null {
  const token = base.OPENCLAW_GATEWAY_TOKEN?.trim();
  if (!token || token.length < 16) return null;
  return {
    ...base,
    OPENCLAW_GATEWAY_TOKEN: token,
    OKX_A2A_OPENCLAW_GATEWAY_TOKEN: token,
  };
}

export interface OpenclawBatchEntry {
  path: string;
  value?: unknown;
  ref?: { provider: string; source: string; id: string };
}

/**
 * The idempotent, pure-local OpenClaw config writes this supervisor is
 * responsible for, expressed as a single `openclaw config set --batch-json`
 * payload rather than one CLI invocation per path.
 *
 * Originally this ran as 8 separate `openclaw config set` invocations. Live
 * on `repodiet-agent-9636`, that consistently degraded under the Machine's
 * `shared-cpu-1x`/512MB limit: local reproduction with the exact pinned
 * `openclaw@2026.7.1-2` CLI showed each cold Node.js start taking ~4-6s
 * unconstrained but ~8-12s under a matching `--memory=512m --cpus=1`
 * constraint, and in production the calls degraded further across boots
 * (each boot pays for 8 separate cold starts) until they blew past this
 * supervisor's own 30s per-call timeout entirely, going from "6-7 of 8
 * calls succeed" on the first boot to "every call times out" on the next.
 * See docs/SELLER_RUNTIME_DEPLOYMENT.md ("Incident #3" follow-up) for the
 * full writeup.
 *
 * `--batch-json` is a real, documented mode of the installed CLI (traced
 * directly from `openclaw`'s own `dist/config-cli-*.js`, not guessed):
 * `[{ path, value }]` for literal values, `[{ path, ref: { provider,
 * source, id } }]` for a SecretRef pointer — the same shape
 * `--ref-provider/--ref-source/--ref-id` builds, so `gateway.auth.token`
 * still carries only a pointer (an env var *name*), never the secret value,
 * on argv. Batch mode is atomic: verified by direct reproduction that a
 * single invalid entry rejects the whole batch rather than partially
 * applying it. Verified end-to-end against the real pinned CLI with the
 * real `@okxweb3/a2a-openclaw` and `repodiet-a2a-bridge` plugin manifests
 * mounted at their real image paths: one ~4.5s call applied and correctly
 * persisted all 8 paths, replacing 8 separate cold starts with one.
 *
 * `session.dmScope` and `plugins.entries.<okx-a2a>.hooks.
 * allowConversationAccess` replicate exactly what `okx-a2a setup
 * openclaw`'s own `ensureOpenClawOkxA2aPluginConfig()` normalizes
 * internally — traced directly from the installed @okxweb3/a2a-node@0.1.10
 * bundle (`OPENCLAW_SESSION_DM_SCOPE_CONFIG_PATH = "session.dmScope"`,
 * value `"per-channel-peer"`; `OPENCLAW_OKX_A2A_CONVERSATION_HOOK_ACCESS_
 * CONFIG_PATH = "plugins.entries.okx-a2a.hooks.allowConversationAccess"`),
 * not guessed — so this supervisor no longer needs to invoke that command
 * (or its network-dependent version-drift/install logic) at all.
 */
export function buildOpenclawConfigBatch(
  trustedPluginIds: string[] = [OKX_A2A_PLUGIN_ID, REPODIET_BRIDGE_PLUGIN_ID],
  bridgePluginId: string = REPODIET_BRIDGE_PLUGIN_ID,
  bridgePluginPath: string = REPODIET_BRIDGE_PLUGIN_PATH,
  okxA2aPluginId: string = OKX_A2A_PLUGIN_ID,
  okxA2aOpenclawPluginPath: string = OKX_A2A_OPENCLAW_PLUGIN_PATH
): OpenclawBatchEntry[] {
  return [
    { path: "gateway.mode", value: "local" },
    { path: "gateway.auth.mode", value: "token" },
    {
      path: "gateway.auth.token",
      ref: { provider: "default", source: "env", id: "OPENCLAW_GATEWAY_TOKEN" },
    },
    { path: "session.dmScope", value: "per-channel-peer" },
    { path: "plugins.load.paths", value: [okxA2aOpenclawPluginPath, bridgePluginPath] },
    { path: `plugins.entries.${okxA2aPluginId}.hooks.allowConversationAccess`, value: true },
    { path: `plugins.entries.${bridgePluginId}.hooks.allowConversationAccess`, value: true },
    { path: "plugins.allow", value: trustedPluginIds },
  ];
}

/** Non-secret metadata this boot's bootstrap would produce — compared against the persisted marker to decide whether to skip config-set. */
export function computeExpectedBootstrapVersions(
  provider: string,
  trustedPluginIds: string[] = [OKX_A2A_PLUGIN_ID, REPODIET_BRIDGE_PLUGIN_ID]
): BootstrapVersions {
  const configPaths = buildOpenclawConfigBatch().map((e) => e.path);
  return {
    onchainOsVersion: ONCHAINOS_VERSION,
    okxA2aVersion: OKX_A2A_VERSION,
    openclawVersion: OPENCLAW_VERSION,
    okxA2aOpenclawPluginVersion: OKX_A2A_OPENCLAW_PLUGIN_VERSION,
    pluginIds: [...trustedPluginIds, `provider:${provider}`],
    configSchemaHash: computeConfigSchemaHash(configPaths),
  };
}

async function configureOpenclaw(env: NodeJS.ProcessEnv): Promise<boolean> {
  const batch = buildOpenclawConfigBatch();
  const startedAt = Date.now();
  const result = await runProcess(
    "openclaw",
    ["config", "set", "--batch-json", JSON.stringify(batch), "--strict-json"],
    { env, timeoutMs: 60_000 }
  );
  if (result.ok) {
    log("openclaw_config_set_batch", { ok: true, paths: batch.map((e) => e.path) });
    return true;
  }
  logCommandFailure(
    "openclaw_config_set_batch_failed",
    "openclaw config set --batch-json <8 entries> --strict-json",
    result,
    Date.now() - startedAt,
    "fatal"
  );
  return false;
}

/**
 * Sole owner of AI-provider selection for the okx-a2a node CLI (see module
 * docblock — scripts/repodiet-seller-runtime.ts no longer calls this).
 * `okx-a2a ai-provider set --provider <provider> --json` is the
 * documented, minimal, purely local equivalent of what the broad `setup`
 * command did as a side effect — confirmed directly from the installed
 * CLI's own --help text and implementation (a PATH check plus a write to
 * a local SQLite session store; no network call).
 */
async function setAiProvider(env: NodeJS.ProcessEnv, provider: string): Promise<boolean> {
  const startedAt = Date.now();
  const result = await runProcess("okx-a2a", ["ai-provider", "set", "--provider", provider, "--json"], {
    env,
    timeoutMs: 15_000,
  });
  if (result.ok) {
    log("ai_provider_set", { ok: true, provider });
  } else {
    logCommandFailure("ai_provider_set_failed", "okx-a2a ai-provider set", result, Date.now() - startedAt, "fatal");
  }
  return result.ok;
}

/**
 * Runs bootstrap end-to-end under the exclusive lock: validate/quarantine
 * the persisted config, skip the config-set sequence entirely when the
 * marker already matches (pure validation instead), otherwise run the
 * full idempotent sequence plus provider selection, validate again, and
 * write a fresh marker only on complete success. Always releases the lock.
 */
async function runBootstrap(env: NodeJS.ProcessEnv): Promise<boolean> {
  const lockPath = bootstrapLockPath(env);
  const configPath = openclawConfigPath(env);
  const markerPath = bootstrapMarkerPath(env);
  const provider = (env.REPODIET_OKX_A2A_PROVIDER?.trim() || "openclaw").toLowerCase();

  const lock = acquireBootstrapLock(lockPath);
  if (!lock.acquired) {
    log("bootstrap_lock_not_acquired", { reason: lock.reason, holderPid: lock.holderPid });
    return false;
  }
  log("bootstrap_lock_acquired", { lockPath });

  try {
    const beforeState = validateOpenclawConfigFile(configPath);
    log("openclaw_config_validated", { when: "before", state: beforeState.state, detail: beforeState.detail });
    if (beforeState.state === "invalid_json" || beforeState.state === "invalid_shape" || beforeState.state === "empty") {
      const quarantined = quarantineInvalidConfig(configPath);
      log("openclaw_config_quarantined", { quarantinedTo: quarantined });
    }

    const expected = computeExpectedBootstrapVersions(provider);
    const marker = readBootstrapMarker(markerPath);
    const configNowValid = validateOpenclawConfigFile(configPath).state === "valid";
    const canSkip = configNowValid && bootstrapMarkerMatches(marker, expected);

    if (canSkip) {
      log("bootstrap_skipped_marker_match", { reason: "pinned versions, plugin set, and config schema unchanged; config already valid" });
      return true;
    }

    log("bootstrap_running", { reason: marker ? "marker_stale_or_config_invalid" : "no_prior_marker" });
    const configured = await configureOpenclaw(env);
    const providerSet = configured && (await setAiProvider(env, provider));
    if (!configured || !providerSet) {
      return false;
    }

    const afterState = validateOpenclawConfigFile(configPath);
    log("openclaw_config_validated", { when: "after", state: afterState.state, detail: afterState.detail });
    if (afterState.state !== "valid") {
      log("bootstrap_failed", { reason: "config_invalid_after_configure" });
      return false;
    }

    writeBootstrapMarker(markerPath, expected);
    log("bootstrap_marker_written", { markerPath });
    return true;
  } finally {
    releaseBootstrapLock(lockPath);
    log("bootstrap_lock_released", { lockPath });
  }
}

/**
 * Plain `fetch()` against the Gateway's own HTTP server — no subprocess.
 * See Incident #7 above for why this replaced a CLI-spawn approach that
 * hung indefinitely in production, immune to timeout increases.
 */
async function fetchGatewayProbe(
  path: string,
  timeoutMs: number,
  headers: Record<string, string> = {}
): Promise<ProcessRunResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${OPENCLAW_GATEWAY_PORT}${path}`, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    const body = await response.text();
    return {
      ok: response.ok,
      exitCode: response.status,
      signal: null,
      stdout: redactProcessOutput(body),
      stderr: "",
      timedOut: false,
      cancelled: false,
    };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "AbortError";
    const cause = err instanceof Error && err.cause instanceof Error ? `: ${err.cause.message}` : "";
    const message = err instanceof Error ? `${err.message}${cause}` : String(err);
    return {
      ok: false,
      exitCode: null,
      signal: null,
      stdout: "",
      stderr: redactProcessOutput(message),
      timedOut,
      cancelled: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `GET /health` — unauthenticated liveness probe. Maps to the same "live"
 * concept `openclaw gateway health` was trying to report (see
 * GATEWAY_PROBE_STATUS_BY_PATH in the real Gateway source), reached via
 * the Gateway's plain HTTP server instead of its RPC client.
 */
async function gatewayHealthy(env: NodeJS.ProcessEnv): Promise<ProcessRunResult> {
  return fetchGatewayProbe("/health", GATEWAY_HEALTH_PROBE_TIMEOUT_MS);
}

/**
 * `GET /ready` with the real bearer token attached. The Gateway's HTTP
 * probe route answers local callers' status code the same way regardless
 * of the token (an `isLocalDirectRequest` bypass in its own source), so
 * this cannot exercise auth *enforcement* the way `--require-rpc` once
 * aimed to — but it does exercise the real internal readiness state
 * (`createReadinessChecker`: startup-pending sidecars, gateway-draining,
 * channel health), which is what actually gates whether it's safe to
 * start the seller runtime. The token is still attached and the response
 * body's `ready` field still checked explicitly, both as defense-in-depth
 * and so a wrong/missing token remains visible in the response shape if
 * that local-bypass behavior ever changes upstream.
 */
async function gatewayAuthenticatedAndReady(env: NodeJS.ProcessEnv): Promise<ProcessRunResult> {
  const token = env.OPENCLAW_GATEWAY_TOKEN;
  const result = await fetchGatewayProbe(
    "/ready",
    GATEWAY_AUTH_PROBE_TIMEOUT_MS,
    token ? { Authorization: `Bearer ${token}` } : {}
  );
  if (!result.ok) return result;
  try {
    const parsed = JSON.parse(result.stdout) as { ready?: boolean };
    return parsed.ready === true ? result : { ...result, ok: false };
  } catch {
    return { ...result, ok: false };
  }
}

/**
 * Proves a plugin is genuinely loaded and its documented hook is
 * registered — not merely that its file exists on disk. `openclaw plugins
 * inspect <id> --runtime --json` is the documented command for this
 * ("shows registered hooks and diagnostics from a module-loaded
 * inspection pass", docs/cli/plugins.md). Fails closed (returns false) on
 * any non-zero exit, unparseable output, or output that does not report
 * the plugin loaded/activated with the expected hook.
 */
export async function verifyPluginActive(
  env: NodeJS.ProcessEnv,
  pluginId: string,
  requiredHook: string
): Promise<boolean> {
  const result = await runProcess("openclaw", ["plugins", "inspect", pluginId, "--runtime", "--json"], {
    env,
    timeoutMs: 20_000,
  });
  if (!result.ok) return false;
  return parsePluginInspection(result.stdout, pluginId, requiredHook);
}

/** Retained for backward-compatible test imports. */
export async function verifyBridgePluginActive(
  env: NodeJS.ProcessEnv,
  pluginId: string = REPODIET_BRIDGE_PLUGIN_ID
): Promise<boolean> {
  return verifyPluginActive(env, pluginId, REPODIET_BRIDGE_PLUGIN_HOOK);
}

export function parseBridgePluginInspection(
  stdout: string,
  pluginId: string = REPODIET_BRIDGE_PLUGIN_ID
): boolean {
  return parsePluginInspection(stdout, pluginId, REPODIET_BRIDGE_PLUGIN_HOOK);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Every failed poll is logged with full, redacted, categorized diagnostics
 * (see command-diagnostics.ts) — not a bare boolean. Built after this exact
 * gap cost an entire investigation cycle live on repodiet-agent-9636: five
 * consecutive boots each hit `openclaw_gateway_not_ready_within_timeout`
 * with zero information about which of the two probes was failing or why.
 */
async function waitForGatewayReady(env: NodeJS.ProcessEnv): Promise<boolean> {
  const deadline = Date.now() + GATEWAY_READY_TIMEOUT_MS;
  let healthy = false;
  while (Date.now() < deadline) {
    if (!healthy) {
      const startedAt = Date.now();
      const result = await gatewayHealthy(env);
      if (result.ok) {
        healthy = true;
        log("gateway_health_ok", {});
      } else {
        logCommandFailure(
          "gateway_health_not_ready_yet",
          "GET http://127.0.0.1:<port>/health",
          result,
          Date.now() - startedAt,
          "will_retry"
        );
      }
    } else {
      const startedAt = Date.now();
      const result = await gatewayAuthenticatedAndReady(env);
      if (result.ok) {
        log("gateway_auth_ready", { url: OPENCLAW_GATEWAY_URL });
        return true;
      }
      logCommandFailure(
        "gateway_auth_not_ready_yet",
        "GET http://127.0.0.1:<port>/ready (authenticated)",
        result,
        Date.now() - startedAt,
        "will_retry"
      );
    }
    await sleep(GATEWAY_READY_POLL_MS);
  }
  return false;
}

interface ManagedChild {
  name: string;
  proc: ChildProcess;
  required: boolean;
}

const children: ManagedChild[] = [];
let shuttingDown = false;

function spawnManaged(
  name: string,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  required: boolean
): ChildProcess {
  const proc = spawn(command, args, { stdio: "inherit", env });
  const entry: ManagedChild = { name, proc, required };
  children.push(entry);

  proc.on("exit", (code, signal) => {
    log(required ? "required_child_exited" : "child_exited", { name, code, signal });
    if (shuttingDown) return;
    if (required) {
      // A required process died on its own — stop everything rather than
      // let the remaining children keep running (and possibly keep
      // reporting readiness) without it.
      void shutdown("required_child_exit", 1);
    }
  });
  proc.on("error", (err) => {
    log("child_spawn_error", { name, message: err instanceof Error ? err.message : String(err) });
  });

  return proc;
}

async function shutdown(reason: string, exitCode: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log("shutdown_started", { reason });

  for (const { name, proc } of children) {
    if (proc.exitCode === null && !proc.killed) {
      try {
        proc.kill("SIGTERM");
        log("forwarded_signal", { name, signal: "SIGTERM" });
      } catch {
        // process already gone
      }
    }
  }

  const deadline = Date.now() + CHILD_SHUTDOWN_GRACE_MS;
  while (Date.now() < deadline && children.some((c) => c.proc.exitCode === null)) {
    await sleep(200);
  }

  for (const { name, proc } of children) {
    if (proc.exitCode === null) {
      try {
        proc.kill("SIGKILL");
        log("force_killed_child", { name });
      } catch {
        // process already gone
      }
    }
  }

  log("shutdown_complete", { reason });
  process.exit(exitCode);
}

process.on("SIGTERM", () => void shutdown("SIGTERM", 0));
process.on("SIGINT", () => void shutdown("SIGINT", 0));

async function main(): Promise<void> {
  log("startup", { gatewayUrl: OPENCLAW_GATEWAY_URL, node: process.version, platform: process.platform });

  const env = buildSupervisorEnv(process.env);
  if (!env) {
    log("startup_failed", { reason: "openclaw_gateway_token_missing_or_too_short" });
    process.exit(1);
    return;
  }

  const bootstrapped = await runBootstrap(env);
  if (!bootstrapped) {
    log("startup_failed", { reason: "openclaw_bootstrap_failed" });
    process.exit(1);
    return;
  }

  spawnManaged("openclaw-gateway", "openclaw", ["gateway", "run", "--port", String(OPENCLAW_GATEWAY_PORT)], env, true);

  const ready = await waitForGatewayReady(env);
  if (!ready) {
    log("startup_failed", { reason: "openclaw_gateway_not_ready_within_timeout", timeoutMs: GATEWAY_READY_TIMEOUT_MS });
    await shutdown("gateway_not_ready", 1);
    return;
  }

  const okxA2aActive = await verifyPluginActive(env, OKX_A2A_PLUGIN_ID, OKX_A2A_PLUGIN_HOOK);
  log("plugin_verified", { ok: okxA2aActive, pluginId: OKX_A2A_PLUGIN_ID });
  const bridgeActive = await verifyPluginActive(env, REPODIET_BRIDGE_PLUGIN_ID, REPODIET_BRIDGE_PLUGIN_HOOK);
  log("plugin_verified", { ok: bridgeActive, pluginId: REPODIET_BRIDGE_PLUGIN_ID });
  if (!okxA2aActive || !bridgeActive) {
    log("startup_failed", { reason: "required_plugin_not_active", okxA2aActive, bridgeActive });
    await shutdown("required_plugin_not_active", 1);
    return;
  }

  // Communication prerequisites (gateway live + authenticated) AND both
  // required plugins (loaded and active, not merely present on disk) are
  // proven — only now does the seller runtime start. It still
  // independently gates its own heartbeat on doctor/daemon, unchanged.
  spawnManaged(
    "repodiet-seller-runtime",
    "node_modules/.bin/tsx",
    ["scripts/repodiet-seller-runtime.ts"],
    env,
    true
  );

  log("running", { note: "supervisor active; managing openclaw-gateway and repodiet-seller-runtime" });
}

// Guarded so this module can be imported for unit testing (buildSupervisorEnv,
// buildOpenclawConfigBatch) without starting the supervisor as a side effect.
if (require.main === module) {
  main().catch((err) => {
    log("fatal", { message: err instanceof Error ? err.message : "unknown_error" });
    process.exit(1);
  });
}
