/**
 * Container process supervisor: OpenClaw Gateway supervision and gateway
 * auth propagation.
 *
 * scripts/repodiet-seller-runtime.ts alone could not fix the reproduced
 * AUTH_TOKEN_MISSING failure: the OpenClaw Gateway process itself was never
 * started under this container (okx-a2a's own post-install restart uses
 * `systemctl --user`, absent under tini). These tests pin the supervisor
 * that fixes that — gateway config, startup ordering, signal forwarding,
 * child-death handling, and secret hygiene.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  buildSupervisorEnv,
  buildOpenclawConfigCalls,
  OPENCLAW_GATEWAY_PORT,
  OPENCLAW_GATEWAY_URL,
  OKX_A2A_PLUGIN_ID,
} from "../scripts/seller-runtime-supervisor";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

const REPO_ROOT = path.resolve(__dirname, "..");
const SUPERVISOR = path.join(REPO_ROOT, "scripts", "seller-runtime-supervisor.ts");

function supervisorSource(): string {
  return fs.readFileSync(SUPERVISOR, "utf8");
}

function run() {
  console.log("seller-runtime-supervisor");

  // --- Gateway wiring constants ------------------------------------------

  test("the gateway is targeted on the documented default port and loopback-only URL", () => {
    assert.equal(OPENCLAW_GATEWAY_PORT, 18789);
    assert.equal(OPENCLAW_GATEWAY_URL, "ws://127.0.0.1:18789");
  });

  test("the trusted plugin id matches the actual installed plugin manifest (openclaw.plugin.json: id=\"okx-a2a\")", () => {
    assert.equal(OKX_A2A_PLUGIN_ID, "okx-a2a");
  });

  // --- Fail-closed env building (AUTH_TOKEN_MISSING regression) ---------

  test("buildSupervisorEnv fails closed when OPENCLAW_GATEWAY_TOKEN is absent", () => {
    const result = buildSupervisorEnv({ NODE_ENV: "test", PATH: "/usr/bin" });
    assert.equal(result, null);
  });

  test("buildSupervisorEnv fails closed when OPENCLAW_GATEWAY_TOKEN is too short to be a real secret", () => {
    const result = buildSupervisorEnv({ NODE_ENV: "test", OPENCLAW_GATEWAY_TOKEN: "short" });
    assert.equal(result, null);
  });

  test("buildSupervisorEnv mirrors the token into OKX_A2A_OPENCLAW_GATEWAY_TOKEN — the separate variable name the okx-a2a daemon/CLI itself reads", () => {
    // Verified directly in the installed @okxweb3/a2a-node 0.1.10 bundle:
    // the daemon's own gateway client reads env.OKX_A2A_OPENCLAW_GATEWAY_TOKEN
    // (falling back to a "synced" config file the OpenClaw plugin writes only
    // after connecting successfully) — a different name from
    // OPENCLAW_GATEWAY_TOKEN, which only the gateway server and the OpenClaw
    // config's gateway.auth.token SecretRef consume. Without mirroring this,
    // a plugin-side hiccup cascades into the daemon also failing to
    // authenticate even though the "real" secret was configured correctly.
    const token = "a-real-32-character-shared-secret-value";
    const result = buildSupervisorEnv({ NODE_ENV: "test", OPENCLAW_GATEWAY_TOKEN: token, PATH: "/usr/bin" });
    assert.ok(result);
    assert.equal(result!.OPENCLAW_GATEWAY_TOKEN, token);
    assert.equal(result!.OKX_A2A_OPENCLAW_GATEWAY_TOKEN, token);
    assert.equal(result!.PATH, "/usr/bin", "unrelated env must pass through unchanged");
  });

  // --- OpenClaw config wiring (the actual, non-guessed schema) -----------

  test("gateway.mode is set to local — openclaw gateway run refuses to start otherwise", () => {
    const calls = buildOpenclawConfigCalls();
    const call = calls.find((c) => c.configPath === "gateway.mode");
    assert.ok(call);
    assert.deepEqual(call!.args, ["config", "set", "gateway.mode", "local"]);
  });

  test("gateway.auth.token is bound via the documented SecretRef builder mode, not a plaintext value", () => {
    const calls = buildOpenclawConfigCalls();
    const call = calls.find((c) => c.configPath === "gateway.auth.token");
    assert.ok(call);
    assert.deepEqual(call!.args, [
      "config",
      "set",
      "gateway.auth.token",
      "--ref-provider",
      "default",
      "--ref-source",
      "env",
      "--ref-id",
      "OPENCLAW_GATEWAY_TOKEN",
    ]);
  });

  test("gateway.auth.mode is set explicitly to token", () => {
    const calls = buildOpenclawConfigCalls();
    const call = calls.find((c) => c.configPath === "gateway.auth.mode");
    assert.ok(call);
    assert.deepEqual(call!.args, ["config", "set", "gateway.auth.mode", "token"]);
  });

  test("plugins.allow explicitly allows the trusted okx-a2a plugin id (PluginsConfig.allow: string[])", () => {
    const calls = buildOpenclawConfigCalls("okx-a2a");
    const call = calls.find((c) => c.configPath === "plugins.allow");
    assert.ok(call);
    assert.deepEqual(call!.args, ["config", "set", "plugins.allow", '["okx-a2a"]', "--strict-json"]);
  });

  test("no config call ever carries a secret value on argv — only path names, literal modes, and SecretRef pointers (env var names)", () => {
    const calls = buildOpenclawConfigCalls();
    for (const call of calls) {
      for (const arg of call.args) {
        assert.ok(
          !/^[A-Za-z0-9+/=]{20,}$/.test(arg) || arg === "OPENCLAW_GATEWAY_TOKEN",
          `argument looks like it could be a secret value, not a name: ${arg}`
        );
      }
    }
  });

  // --- Startup ordering ----------------------------------------------------

  test("OpenClaw config is written and the plugin is registered before the Gateway process is spawned", () => {
    const src = supervisorSource();
    const configureIndex = src.indexOf("await configureOpenclaw(env)");
    const registerIndex = src.indexOf("await registerOkxA2aPlugin(env)");
    const spawnGatewayIndex = src.indexOf('spawnManaged("openclaw-gateway"');
    assert.ok(configureIndex > -1 && registerIndex > -1 && spawnGatewayIndex > -1);
    assert.ok(configureIndex < spawnGatewayIndex, "config must be written before the gateway starts");
    assert.ok(
      registerIndex < spawnGatewayIndex,
      "the plugin must be registered before the gateway starts — activation.onStartup and the restart-required note on plugins.entries writes both mean registering it after the gateway is already running would not activate it this boot"
    );
  });

  test("the seller runtime starts only after the gateway is proven live and authenticated", () => {
    const src = supervisorSource();
    const waitIndex = src.indexOf("const ready = await waitForGatewayReady(env)");
    const sellerSpawnIndex = src.indexOf('spawnManaged(\n    "repodiet-seller-runtime"');
    assert.ok(waitIndex > -1 && sellerSpawnIndex > -1);
    assert.ok(waitIndex < sellerSpawnIndex, "communication prerequisites must be proven before the seller runtime starts");
  });

  test("readiness is checked via the documented auth-resolving probe (gateway status --require-rpc), never by passing the token on argv", () => {
    const src = supervisorSource();
    assert.ok(src.includes('"gateway", "status", "--require-rpc", "--json"'));
    assert.ok(!/--token["'`]?,?\s*(token|env\.OPENCLAW_GATEWAY_TOKEN)/.test(src));
  });

  // --- Signal forwarding and child-process cleanup (regression) ---------

  test("SIGTERM and SIGINT are both handled and trigger the same shutdown path", () => {
    const src = supervisorSource();
    assert.ok(src.includes('process.on("SIGTERM"'));
    assert.ok(src.includes('process.on("SIGINT"'));
    assert.ok(src.includes('shutdown("SIGTERM"'));
    assert.ok(src.includes('shutdown("SIGINT"'));
  });

  test("shutdown forwards SIGTERM to every managed child before force-killing", () => {
    const src = supervisorSource();
    const forwardIndex = src.indexOf('proc.kill("SIGTERM")');
    const killIndex = src.indexOf('proc.kill("SIGKILL")');
    assert.ok(forwardIndex > -1 && killIndex > -1);
    assert.ok(forwardIndex < killIndex, "SIGTERM must be attempted before SIGKILL");
    assert.ok(src.includes("CHILD_SHUTDOWN_GRACE_MS"), "force-kill must be bounded by a grace period, not immediate");
  });

  test("children are reaped via their own exit event, not left to leak zombies", () => {
    const src = supervisorSource();
    assert.ok(src.includes('proc.on("exit"'));
  });

  // --- Fail-closed on a required child dying (regression) ----------------

  test("an unrequested exit of a required child tears down the whole supervisor instead of continuing degraded", () => {
    const src = supervisorSource();
    assert.ok(src.includes("required_child_exited"));
    assert.ok(src.includes('void shutdown("required_child_exit", 1)'));
  });

  test("both the gateway and the seller runtime are registered as required children", () => {
    const src = supervisorSource();
    const gatewaySpawn = src.match(/spawnManaged\("openclaw-gateway"[\s\S]{0,200}?\btrue\);/);
    const sellerSpawn = src.match(/spawnManaged\(\s*"repodiet-seller-runtime"[\s\S]{0,200}?\btrue\s*\);/);
    assert.ok(gatewaySpawn, "the gateway child must be spawned as required");
    assert.ok(sellerSpawn, "the seller-runtime child must be spawned as required");
  });

  test("startup fails closed (non-zero exit) at every hard prerequisite, never silently downgrading to unauthenticated", () => {
    const src = supervisorSource();
    for (const reason of [
      "openclaw_gateway_token_missing_or_too_short",
      "openclaw_config_set_failed",
      "okx_a2a_plugin_registration_failed",
      "openclaw_gateway_not_ready_within_timeout",
    ]) {
      assert.ok(src.includes(reason), `missing fail-closed path for: ${reason}`);
    }
  });

  // --- Secret hygiene ------------------------------------------------------

  test("the token value itself is never passed to log()", () => {
    const src = supervisorSource();
    // Every log() call in this file must be inspectable: none may reference
    // the resolved token variable or a raw env lookup of it.
    const logCalls = src.match(/log\("[a-z_]+",\s*\{[^}]*\}\)/g) ?? [];
    assert.ok(logCalls.length > 5, "sanity check: log() calls should exist to scan");
    for (const call of logCalls) {
      assert.ok(!/\btoken\b(?!Configured|Path)/i.test(call.replace(/openclaw_gateway_token_missing_or_too_short/, "")), `log call may leak the token: ${call}`);
    }
  });

  test("child processes inherit the resolved env object, never a literal secret constructed inline", () => {
    const src = supervisorSource();
    assert.ok(!/OPENCLAW_GATEWAY_TOKEN\s*[:=]\s*["'`][^"'`]+["'`]/.test(src), "no literal token value may be hardcoded");
  });

  console.log("seller-runtime-supervisor: all passed");
}

run();
