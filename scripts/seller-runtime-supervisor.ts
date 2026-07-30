#!/usr/bin/env tsx
/**
 * Container process supervisor for the RepoDiet seller runtime (Agent 9636).
 *
 * This is the new Dockerfile.seller CMD. It owns everything
 * scripts/repodiet-seller-runtime.ts could not own by itself: the OpenClaw
 * Gateway process. Previously the container started exactly one foreground
 * process (repodiet-seller-runtime.ts) and left the Gateway unsupervised —
 * `okx-a2a setup openclaw`'s own post-install restart shells out to
 * `systemctl --user`, which does not exist in this container (no session
 * manager under tini PID 1), so it silently logged "Gateway service
 * disabled" and the actual Gateway (the WebSocket/HTTP server other
 * processes authenticate against) never started.
 *
 * Startup order (each step is a hard prerequisite for the next):
 *   1. Verify OPENCLAW_GATEWAY_TOKEN is configured (fail closed otherwise).
 *   2. Write the token into OpenClaw's own config as the documented
 *      SecretRef form (`openclaw config set gateway.auth.token --ref-source
 *      env --ref-id OPENCLAW_GATEWAY_TOKEN`); explicitly allow both trusted
 *      plugins (`plugins.allow`: `okx-a2a` and `repodiet-a2a-bridge`);
 *      register the bridge's standalone plugin directory
 *      (`plugins.load.paths`, docs/gateway/configuration-reference.md:
 *      "files or directories listed in plugins.load.paths"); and grant it
 *      conversation-hook access (`plugins.entries.repodiet-a2a-bridge.
 *      hooks.allowConversationAccess`, required for any non-bundled plugin
 *      using `before_agent_reply` — docs/plugins/hooks.md) — verified
 *      against the actual installed openclaw@2026.7.1-2 CLI docs
 *      (docs/cli/config.md, docs/cli/gateway.md) and config schema
 *      (dist/types.openclaw-*.d.ts: GatewayAuthConfig.token: SecretInput,
 *      PluginsConfig.allow: string[]), not guessed.
 *   3. Register the okx-a2a plugin into that config (`okx-a2a setup
 *      openclaw`) BEFORE the Gateway starts — the plugin's manifest
 *      (openclaw.plugin.json) declares `activation.onStartup: true`, and
 *      the CLI docs state writes to `plugins.entries`/`plugins.allow`
 *      "always require a restart" to take effect, so registering it after
 *      the Gateway is already running would not activate it this boot.
 *      repodiet-a2a-bridge's own manifest also declares
 *      `activation.onStartup: true` for the same reason.
 *   4. Start `openclaw gateway run` ourselves as a managed foreground child
 *      (the documented explicit foreground form — see docs/cli/gateway.md)
 *      instead of relying on okx-a2a's systemctl-based auto-restart.
 *   5. Poll until the Gateway is live (`gateway health`) AND authenticated
 *      (`gateway status --require-rpc`, which resolves the SecretRef we
 *      just configured and exits non-zero on any auth/read failure — this
 *      is the documented way to prove auth end-to-end without putting the
 *      token on a command line).
 *   6. Verify repodiet-a2a-bridge is genuinely loaded and active —
 *      `openclaw plugins inspect repodiet-a2a-bridge --runtime --json`
 *      (documented: "shows registered hooks and diagnostics from a
 *      module-loaded inspection pass", docs/cli/plugins.md). A plugin file
 *      existing on disk is not proof it loaded — this step fails the whole
 *      startup closed if the inspection does not report the plugin present
 *      with its `before_agent_reply` hook registered.
 *   7. Only then start scripts/repodiet-seller-runtime.ts, which still owns
 *      identity verification, `okx-a2a setup`/`doctor --fix`/`daemon`, and
 *      the heartbeat loop exactly as before — this supervisor does not
 *      duplicate or weaken any of that.
 *
 * A second, independently-discovered fix lives here too: the `okx-a2a`
 * daemon/CLI (a separate process from the OpenClaw plugin) reads its OWN
 * gateway credentials from `OKX_A2A_OPENCLAW_GATEWAY_TOKEN` — a different
 * variable name from the `OPENCLAW_GATEWAY_TOKEN` the Gateway server and
 * the OpenClaw-side plugin config use — falling back to a "synced" config
 * file the plugin writes only after it has itself connected successfully.
 * Verified directly in the installed @okxweb3/a2a-node 0.1.10 bundle
 * (`env.OKX_A2A_OPENCLAW_GATEWAY_TOKEN`). Without mirroring it explicitly,
 * a plugin-side connection hiccup cascades into the daemon also failing to
 * authenticate. This supervisor sets both names from the one staged secret.
 *
 * Fails closed throughout: any required step that does not genuinely
 * succeed stops the container with a non-zero exit rather than starting the
 * seller runtime in a state that could report false readiness. Never logs
 * the token value — only whether each step succeeded.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { runProcess } from "../src/lib/okx-runtime/process-runner";
import { parsePluginInspection } from "../src/lib/okx-runtime/plugin-inspection";

export const OPENCLAW_GATEWAY_PORT = Number(process.env.OPENCLAW_GATEWAY_PORT || 18789);
export const OPENCLAW_GATEWAY_URL = `ws://127.0.0.1:${OPENCLAW_GATEWAY_PORT}`;
export const OKX_A2A_PLUGIN_ID = "okx-a2a";
// Matches openclaw-plugins/repodiet-a2a-bridge/openclaw.plugin.json's "id".
export const REPODIET_BRIDGE_PLUGIN_ID = "repodiet-a2a-bridge";
// Matches Dockerfile.seller's WORKDIR (/app) + COPY of openclaw-plugins/.
export const REPODIET_BRIDGE_PLUGIN_PATH = "/app/openclaw-plugins/repodiet-a2a-bridge";

const GATEWAY_READY_TIMEOUT_MS = Number(
  process.env.REPODIET_OPENCLAW_GATEWAY_READY_TIMEOUT_MS || 120_000
);
const GATEWAY_READY_POLL_MS = Number(process.env.REPODIET_OPENCLAW_GATEWAY_READY_POLL_MS || 3_000);
const CHILD_SHUTDOWN_GRACE_MS = 15_000;

type LogFields = Record<string, unknown>;

function log(event: string, fields: LogFields = {}): void {
  // Structured, single-line, secret-free — same convention as
  // repodiet-seller-runtime.ts. Callers below only ever pass booleans,
  // counts, paths, and CLI exit status — never process output or env values.
  console.log(JSON.stringify({ at: new Date().toISOString(), component: "supervisor", event, ...fields }));
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

export interface OpenclawConfigCall {
  configPath: string;
  args: string[];
  description: string;
}

/**
 * The one-time OpenClaw config writes this supervisor is responsible for.
 * Every arg here is a path name, mode literal, or SecretRef *pointer*
 * (env var name) — never a secret value — so this list is safe to log
 * verbatim, and safe to pass on argv (no token ever appears there).
 */
export function buildOpenclawConfigCalls(
  trustedPluginIds: string[] = [OKX_A2A_PLUGIN_ID, REPODIET_BRIDGE_PLUGIN_ID],
  bridgePluginId: string = REPODIET_BRIDGE_PLUGIN_ID,
  bridgePluginPath: string = REPODIET_BRIDGE_PLUGIN_PATH
): OpenclawConfigCall[] {
  return [
    {
      configPath: "gateway.mode",
      args: ["config", "set", "gateway.mode", "local"],
      description: "allow the CLI to start the gateway locally (openclaw gateway run refuses otherwise)",
    },
    {
      configPath: "gateway.auth.mode",
      args: ["config", "set", "gateway.auth.mode", "token"],
      description: "select token auth explicitly rather than relying on default inference",
    },
    {
      configPath: "gateway.auth.token",
      args: [
        "config",
        "set",
        "gateway.auth.token",
        "--ref-provider",
        "default",
        "--ref-source",
        "env",
        "--ref-id",
        "OPENCLAW_GATEWAY_TOKEN",
      ],
      description: "bind the shared gateway token to the OPENCLAW_GATEWAY_TOKEN SecretRef (documented builder mode)",
    },
    {
      configPath: "plugins.load.paths",
      args: ["config", "set", "plugins.load.paths", JSON.stringify([bridgePluginPath]), "--strict-json"],
      description: `register the standalone repodiet-a2a-bridge plugin directory (docs/gateway/configuration-reference.md: "files or directories listed in plugins.load.paths")`,
    },
    {
      configPath: `plugins.entries.${bridgePluginId}.hooks.allowConversationAccess`,
      args: [
        "config",
        "set",
        `plugins.entries.${bridgePluginId}.hooks.allowConversationAccess`,
        "true",
        "--strict-json",
      ],
      description: "required for any non-bundled plugin using a conversation hook (before_agent_reply) — docs/plugins/hooks.md",
    },
    {
      configPath: "plugins.allow",
      args: ["config", "set", "plugins.allow", JSON.stringify(trustedPluginIds), "--strict-json"],
      description: `explicitly allow the trusted plugins (PluginsConfig.allow): ${trustedPluginIds.join(", ")}`,
    },
  ];
}

async function configureOpenclaw(env: NodeJS.ProcessEnv): Promise<boolean> {
  let allOk = true;
  for (const call of buildOpenclawConfigCalls()) {
    const result = await runProcess("openclaw", call.args, { env, timeoutMs: 30_000 });
    log("openclaw_config_set", { path: call.configPath, ok: result.ok, description: call.description });
    if (!result.ok) allOk = false;
  }
  return allOk;
}

async function registerOkxA2aPlugin(env: NodeJS.ProcessEnv): Promise<boolean> {
  // Must run before the Gateway starts — see module docblock step 3.
  const result = await runProcess("okx-a2a", ["setup", "openclaw", "--release", "latest", "--json"], {
    env,
    timeoutMs: 120_000,
  });
  log("plugin_registered", { ok: result.ok, pluginId: OKX_A2A_PLUGIN_ID });
  return result.ok;
}

async function gatewayHealthy(env: NodeJS.ProcessEnv): Promise<boolean> {
  const result = await runProcess("openclaw", ["gateway", "health", "--port", String(OPENCLAW_GATEWAY_PORT), "--json"], {
    env,
    timeoutMs: 10_000,
  });
  return result.ok;
}

/**
 * `gateway status --require-rpc` resolves the configured auth SecretRef
 * itself and "exit[s] non-zero only when no probed target is reachable" /
 * fails the upgraded read-scope probe — the documented way to prove the
 * Gateway is live AND authenticated without ever putting the token value
 * on a command line (contrast: `--url` mode requires an explicit
 * `--token`, which this deliberately avoids).
 */
async function gatewayAuthenticatedAndReady(env: NodeJS.ProcessEnv): Promise<boolean> {
  const result = await runProcess("openclaw", ["gateway", "status", "--require-rpc", "--json"], {
    env,
    timeoutMs: 15_000,
  });
  return result.ok;
}

/**
 * Proves repodiet-a2a-bridge is genuinely loaded and its
 * `before_agent_reply` hook is registered — not merely that the plugin
 * file exists on disk. `openclaw plugins inspect <id> --runtime --json`
 * is the documented command for this ("shows registered hooks and
 * diagnostics from a module-loaded inspection pass", docs/cli/plugins.md).
 * Fails closed (returns false) on any non-zero exit, unparseable output,
 * or output that does not name both the plugin id and the hook.
 */
/**
 * Re-exported for backward-compatible test imports; the real parsing logic
 * (and the real-verified schema it depends on) lives in the shared
 * src/lib/okx-runtime/plugin-inspection.ts, so scripts/seller-production-
 * readiness.ts can reuse the exact same parser without duplicating it or
 * importing this module's top-level SIGTERM/SIGINT handlers as a side
 * effect.
 */
export function parseBridgePluginInspection(
  stdout: string,
  pluginId: string = REPODIET_BRIDGE_PLUGIN_ID
): boolean {
  return parsePluginInspection(stdout, pluginId, "before_agent_reply");
}

export async function verifyBridgePluginActive(
  env: NodeJS.ProcessEnv,
  pluginId: string = REPODIET_BRIDGE_PLUGIN_ID
): Promise<boolean> {
  const result = await runProcess("openclaw", ["plugins", "inspect", pluginId, "--runtime", "--json"], {
    env,
    timeoutMs: 20_000,
  });
  if (!result.ok) return false;
  return parseBridgePluginInspection(result.stdout, pluginId);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForGatewayReady(env: NodeJS.ProcessEnv): Promise<boolean> {
  const deadline = Date.now() + GATEWAY_READY_TIMEOUT_MS;
  let healthy = false;
  while (Date.now() < deadline) {
    if (!healthy) {
      healthy = await gatewayHealthy(env);
      if (healthy) log("gateway_health_ok", {});
    } else {
      const authReady = await gatewayAuthenticatedAndReady(env);
      if (authReady) {
        log("gateway_auth_ready", { url: OPENCLAW_GATEWAY_URL });
        return true;
      }
      log("gateway_auth_not_ready_yet", {});
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

  const configured = await configureOpenclaw(env);
  if (!configured) {
    log("startup_failed", { reason: "openclaw_config_set_failed" });
    process.exit(1);
    return;
  }

  const registered = await registerOkxA2aPlugin(env);
  if (!registered) {
    log("startup_failed", { reason: "okx_a2a_plugin_registration_failed" });
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

  const bridgeActive = await verifyBridgePluginActive(env);
  log("bridge_plugin_verified", { ok: bridgeActive, pluginId: REPODIET_BRIDGE_PLUGIN_ID });
  if (!bridgeActive) {
    log("startup_failed", { reason: "repodiet_a2a_bridge_not_active" });
    await shutdown("bridge_plugin_not_active", 1);
    return;
  }

  // Communication prerequisites (gateway live + authenticated) AND the
  // real dispatch bridge (loaded and active, not merely present on disk)
  // are proven — only now does the seller runtime start. It still
  // independently gates its own heartbeat on okx-a2a setup/doctor/daemon,
  // unchanged.
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
// buildOpenclawConfigCalls) without starting the supervisor as a side effect.
if (require.main === module) {
  main().catch((err) => {
    log("fatal", { message: err instanceof Error ? err.message : "unknown_error" });
    process.exit(1);
  });
}
