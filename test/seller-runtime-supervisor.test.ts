/**
 * Container process supervisor: OpenClaw Gateway supervision, idempotent
 * bootstrap, and dual-plugin activation gating.
 *
 * scripts/repodiet-seller-runtime.ts alone could not fix the reproduced
 * AUTH_TOKEN_MISSING failure: the OpenClaw Gateway process itself was never
 * started under this container (okx-a2a's own post-install restart uses
 * `systemctl --user`, absent under tini). These tests pin the supervisor
 * that fixes that — gateway config, startup ordering, signal forwarding,
 * child-death handling, and secret hygiene — AND the Incident #2
 * remediation: the broad, network-dependent `okx-a2a setup openclaw
 * --release latest` is gone, replaced by a pinned, idempotent,
 * lock-guarded, version-aware bootstrap. See
 * docs/SELLER_RUNTIME_DEPLOYMENT.md for the full incident writeup.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  buildSupervisorEnv,
  buildOpenclawConfigBatch,
  computeExpectedBootstrapVersions,
  verifyPluginActive,
  observeGatewayStdoutChunk,
  resetGatewayLoadedPluginIdsForTests,
  getGatewayLoadedPluginIdsForTests,
  OPENCLAW_GATEWAY_PORT,
  OPENCLAW_GATEWAY_URL,
  OKX_A2A_PLUGIN_ID,
  OKX_A2A_PLUGIN_HOOK,
  OKX_A2A_OPENCLAW_PLUGIN_PATH,
  OKX_A2A_OPENCLAW_PLUGIN_VERSION,
  REPODIET_BRIDGE_PLUGIN_ID,
  REPODIET_BRIDGE_PLUGIN_HOOK,
  REPODIET_BRIDGE_PLUGIN_PATH,
  ONCHAINOS_VERSION,
  OKX_A2A_VERSION,
  OPENCLAW_VERSION,
} from "../scripts/seller-runtime-supervisor";
import { parseGatewayListeningPluginIds } from "../src/lib/okx-runtime/plugin-activation-proof";

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
const DOCKERFILE = path.join(REPO_ROOT, "Dockerfile.seller");

function supervisorSource(): string {
  return fs.readFileSync(SUPERVISOR, "utf8");
}

function dockerfileSource(): string {
  return fs.readFileSync(DOCKERFILE, "utf8");
}

function run() {
  console.log("seller-runtime-supervisor");

  // --- Gateway wiring constants ------------------------------------------

  test("the gateway is targeted on the documented default port and loopback-only URL", () => {
    assert.equal(OPENCLAW_GATEWAY_PORT, 18789);
    assert.equal(OPENCLAW_GATEWAY_URL, "ws://127.0.0.1:18789");
  });

  test("the okx-a2a plugin id/hook/path match the actual pinned @okxweb3/a2a-openclaw manifest", () => {
    assert.equal(OKX_A2A_PLUGIN_ID, "okx-a2a");
    assert.equal(OKX_A2A_PLUGIN_HOOK, "before_agent_run");
    assert.equal(OKX_A2A_OPENCLAW_PLUGIN_PATH, "/app/openclaw-plugins/okx-a2a-openclaw");
  });

  test("the bridge plugin id/hook/path match openclaw-plugins/repodiet-a2a-bridge", () => {
    assert.equal(REPODIET_BRIDGE_PLUGIN_ID, "repodiet-a2a-bridge");
    assert.equal(REPODIET_BRIDGE_PLUGIN_HOOK, "before_agent_reply");
    assert.equal(REPODIET_BRIDGE_PLUGIN_PATH, "/app/openclaw-plugins/repodiet-a2a-bridge");
  });

  // --- Pinned versions stay in sync with Dockerfile.seller's ARG defaults -
  //
  // The bootstrap marker is keyed on these constants (see
  // computeExpectedBootstrapVersions / src/lib/okx-runtime/openclaw-
  // bootstrap.ts). If a version were bumped in one file and not the other,
  // the marker would never invalidate correctly against the image that
  // actually shipped — so this is a real correctness property, not
  // cosmetic.

  test("pinned version constants match Dockerfile.seller's ARG defaults exactly", () => {
    const dockerfile = dockerfileSource();
    assert.ok(dockerfile.includes(`ARG ONCHAINOS_RELEASE_TAG=v${ONCHAINOS_VERSION}`), "ONCHAINOS_VERSION drifted from Dockerfile.seller");
    assert.ok(dockerfile.includes(`ARG OKX_A2A_VERSION=${OKX_A2A_VERSION}`), "OKX_A2A_VERSION drifted from Dockerfile.seller");
    assert.ok(dockerfile.includes(`ARG OPENCLAW_VERSION=${OPENCLAW_VERSION}`), "OPENCLAW_VERSION drifted from Dockerfile.seller");
    assert.ok(
      dockerfile.includes(`ARG OKX_A2A_OPENCLAW_PLUGIN_VERSION=${OKX_A2A_OPENCLAW_PLUGIN_VERSION}`),
      "OKX_A2A_OPENCLAW_PLUGIN_VERSION drifted from Dockerfile.seller"
    );
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
    const token = "a-real-32-character-shared-secret-value";
    const result = buildSupervisorEnv({ NODE_ENV: "test", OPENCLAW_GATEWAY_TOKEN: token, PATH: "/usr/bin" });
    assert.ok(result);
    assert.equal(result!.OPENCLAW_GATEWAY_TOKEN, token);
    assert.equal(result!.OKX_A2A_OPENCLAW_GATEWAY_TOKEN, token);
    assert.equal(result!.PATH, "/usr/bin", "unrelated env must pass through unchanged");
  });

  // --- OpenClaw config wiring (the actual, non-guessed schema) -----------
  //
  // These 8 entries are now issued as a single `openclaw config set
  // --batch-json` call (see buildOpenclawConfigBatch) instead of 8 separate
  // CLI invocations — replaced after live evidence on repodiet-agent-9636
  // showed 8 separate cold Node.js starts per boot degrading under the
  // Machine's shared-cpu-1x/512MB limit until every call exceeded this
  // supervisor's own timeout. Batch mode is a real, documented CLI feature,
  // verified end-to-end against the real pinned CLI with the real plugin
  // manifests mounted at their real image paths.

  test("gateway.mode is set to local — openclaw gateway run refuses to start otherwise", () => {
    const batch = buildOpenclawConfigBatch();
    const entry = batch.find((e) => e.path === "gateway.mode");
    assert.deepEqual(entry, { path: "gateway.mode", value: "local" });
  });

  test("gateway.auth.token is bound via a SecretRef pointer (provider/source/id), not a plaintext value", () => {
    const batch = buildOpenclawConfigBatch();
    const entry = batch.find((e) => e.path === "gateway.auth.token");
    assert.deepEqual(entry, {
      path: "gateway.auth.token",
      ref: { provider: "default", source: "env", id: "OPENCLAW_GATEWAY_TOKEN" },
    });
  });

  test("gateway.auth.mode is set explicitly to token", () => {
    const batch = buildOpenclawConfigBatch();
    const entry = batch.find((e) => e.path === "gateway.auth.mode");
    assert.deepEqual(entry, { path: "gateway.auth.mode", value: "token" });
  });

  test("session.dmScope is normalized to per-channel-peer — traced from okx-a2a's own ensureOpenClawOkxA2aPluginConfig(), not guessed", () => {
    const batch = buildOpenclawConfigBatch();
    const entry = batch.find((e) => e.path === "session.dmScope");
    assert.deepEqual(entry, { path: "session.dmScope", value: "per-channel-peer" });
  });

  test("plugins.allow explicitly allows BOTH trusted plugin ids by default (PluginsConfig.allow: string[])", () => {
    const batch = buildOpenclawConfigBatch();
    const entry = batch.find((e) => e.path === "plugins.allow");
    assert.deepEqual(entry, { path: "plugins.allow", value: ["okx-a2a", "repodiet-a2a-bridge"] });
  });

  test("plugins.allow accepts an explicit override list", () => {
    const batch = buildOpenclawConfigBatch(["okx-a2a"]);
    const entry = batch.find((e) => e.path === "plugins.allow");
    assert.deepEqual(entry, { path: "plugins.allow", value: ["okx-a2a"] });
  });

  test("plugins.load.paths registers BOTH standalone plugin directories baked into the image at build time", () => {
    const batch = buildOpenclawConfigBatch();
    const entry = batch.find((e) => e.path === "plugins.load.paths");
    assert.deepEqual(entry, {
      path: "plugins.load.paths",
      value: ["/app/openclaw-plugins/okx-a2a-openclaw", "/app/openclaw-plugins/repodiet-a2a-bridge"],
    });
  });

  test("the okx-a2a plugin is granted conversation-hook access, required for before_agent_run/agent_end", () => {
    const batch = buildOpenclawConfigBatch();
    const entry = batch.find((e) => e.path === "plugins.entries.okx-a2a.hooks.allowConversationAccess");
    assert.deepEqual(entry, { path: "plugins.entries.okx-a2a.hooks.allowConversationAccess", value: true });
  });

  test("the bridge plugin is granted conversation-hook access, required for before_agent_reply", () => {
    const batch = buildOpenclawConfigBatch();
    const entry = batch.find((e) => e.path === "plugins.entries.repodiet-a2a-bridge.hooks.allowConversationAccess");
    assert.deepEqual(entry, {
      path: "plugins.entries.repodiet-a2a-bridge.hooks.allowConversationAccess",
      value: true,
    });
  });

  test("the batch has exactly 8 entries — no path silently dropped or duplicated", () => {
    const batch = buildOpenclawConfigBatch();
    assert.equal(batch.length, 8);
    const paths = batch.map((e) => e.path);
    assert.equal(new Set(paths).size, 8, "no duplicate paths");
  });

  test("no batch entry ever carries a secret value — only path names, literal modes, and SecretRef pointers (provider/source/id, an env var name)", () => {
    const batch = buildOpenclawConfigBatch();
    for (const entry of batch) {
      if (entry.ref) {
        assert.equal(entry.ref.id, "OPENCLAW_GATEWAY_TOKEN", "a ref's id must be an env var name, not a value");
        continue;
      }
      const serialized = JSON.stringify(entry.value);
      assert.ok(
        !/^"[A-Za-z0-9+/=]{20,}"$/.test(serialized),
        `entry value looks like it could be a secret value, not a literal: ${serialized}`
      );
    }
  });

  test("the batch is passed to the CLI as a single --batch-json argument, never as 8 separate config-set invocations", () => {
    const src = supervisorSource();
    assert.ok(src.includes('["config", "set", "--batch-json", JSON.stringify(batch), "--strict-json"]'));
  });

  // --- Incident #2 remediation: no boot-time network dependency ----------

  test("the broad, network-dependent `okx-a2a setup <target> --release latest` is never called by this supervisor", () => {
    const src = supervisorSource();
    // Matches an actual CLI argv literal (as it would appear in a runProcess
    // args array), not prose inside comments describing the incident/root
    // cause — those legitimately reference the retired flag by name.
    assert.ok(!/"--release"/.test(src), "no --release flag may appear in an actual command invocation — versions are pinned at build time only");
    assert.ok(!/\["setup"/.test(src) && !/,\s*"setup"/.test(src), "the broad setup command must not be invoked at boot");
  });

  test("provider selection uses the documented minimal local command, ai-provider set, not the broad setup command", () => {
    const src = supervisorSource();
    assert.ok(src.includes('"ai-provider", "set", "--provider", provider, "--json"'));
  });

  test("provider selection defaults to openclaw and honors REPODIET_OKX_A2A_PROVIDER, matching repodiet-seller-runtime.ts's own default", () => {
    const src = supervisorSource();
    assert.ok(src.includes('env.REPODIET_OKX_A2A_PROVIDER?.trim() || "openclaw"'));
  });

  // --- Bootstrap lock, validation, quarantine, and marker skip logic -----

  test("bootstrap runs under an exclusive lock that is always released, success or failure", () => {
    const src = supervisorSource();
    const acquireIndex = src.indexOf("const lock = acquireBootstrapLock(lockPath)");
    const tryIndex = src.indexOf("try {", acquireIndex);
    const finallyIndex = src.indexOf("} finally {", tryIndex);
    const releaseIndex = src.indexOf("releaseBootstrapLock(lockPath)", finallyIndex);
    assert.ok(acquireIndex > -1 && tryIndex > -1 && finallyIndex > -1 && releaseIndex > -1);
    assert.ok(finallyIndex < releaseIndex, "the lock must be released from a finally block, not only on the success path");
  });

  test("bootstrap fails closed (does not proceed) when the lock cannot be acquired", () => {
    const src = supervisorSource();
    assert.ok(src.includes("bootstrap_lock_not_acquired"));
    assert.ok(src.includes("if (!lock.acquired)"));
    const notAcquiredIndex = src.indexOf("if (!lock.acquired)");
    const returnFalseIndex = src.indexOf("return false", notAcquiredIndex);
    assert.ok(returnFalseIndex > -1 && returnFalseIndex - notAcquiredIndex < 200, "must return failure, not fall through to configuring");
  });

  test("an invalid persisted config is quarantined (never deleted) before bootstrap proceeds", () => {
    const src = supervisorSource();
    assert.ok(src.includes("quarantineInvalidConfig(configPath)"));
    assert.ok(src.includes("openclaw_config_quarantined"));
    assert.ok(!/fs\.(rm|unlink)/.test(src), "the supervisor itself must never delete the config — quarantine only renames");
  });

  test("bootstrap is skipped (validation only) when the marker matches and the config is already valid", () => {
    const src = supervisorSource();
    assert.ok(src.includes("bootstrapMarkerMatches(marker, expected)"));
    assert.ok(src.includes("bootstrap_skipped_marker_match"));
    const canSkipIndex = src.indexOf("const canSkip =");
    const skipLogIndex = src.indexOf("bootstrap_skipped_marker_match");
    const configureIndex = src.indexOf("const configured = await configureOpenclaw(env)");
    assert.ok(canSkipIndex > -1 && skipLogIndex > -1 && configureIndex > -1);
    assert.ok(canSkipIndex < skipLogIndex && skipLogIndex < configureIndex, "the skip check must precede the config-set sequence");
  });

  test("bootstrap reruns the config-set sequence when the marker is stale or absent", () => {
    const src = supervisorSource();
    assert.ok(src.includes("bootstrap_running"));
    assert.ok(src.includes('reason: marker ? "marker_stale_or_config_invalid" : "no_prior_marker"'));
  });

  test("a fresh marker is written only after the config is re-validated and confirmed valid post-configure", () => {
    const src = supervisorSource();
    const afterValidateIndex = src.indexOf('log("openclaw_config_validated", { when: "after"');
    const invalidBailIndex = src.indexOf('if (afterState.state !== "valid")');
    const writeMarkerIndex = src.indexOf("writeBootstrapMarker(markerPath, expected)");
    assert.ok(afterValidateIndex > -1 && invalidBailIndex > -1 && writeMarkerIndex > -1);
    assert.ok(afterValidateIndex < invalidBailIndex && invalidBailIndex < writeMarkerIndex);
  });

  test("computeExpectedBootstrapVersions ties the marker to the provider and the exact config-set path list", () => {
    const openclaw = computeExpectedBootstrapVersions("openclaw");
    const hermes = computeExpectedBootstrapVersions("hermes");
    assert.notDeepEqual(openclaw.pluginIds, hermes.pluginIds, "a provider change must produce a different marker");
    assert.ok(openclaw.pluginIds.includes("provider:openclaw"));
    assert.equal(typeof openclaw.configSchemaHash, "string");
    assert.ok(openclaw.configSchemaHash.length > 0);
  });

  // --- Failure diagnostics (redacted, categorized) ------------------------

  test("command failures are logged via buildCommandFailureDiagnostics, not a bare ok:false", () => {
    const src = supervisorSource();
    assert.ok(src.includes("buildCommandFailureDiagnostics(command, result, durationMs, retryDecision)"));
    assert.ok(src.includes("logCommandFailure("));
  });

  // --- Startup ordering ----------------------------------------------------

  test("bootstrap completes before the Gateway process is spawned", () => {
    const src = supervisorSource();
    const bootstrapIndex = src.indexOf("const bootstrapped = await runBootstrap(env)");
    const spawnGatewayIndex = src.search(/spawnManaged\(\s*"openclaw-gateway"/);
    assert.ok(bootstrapIndex > -1 && spawnGatewayIndex > -1);
    assert.ok(bootstrapIndex < spawnGatewayIndex, "bootstrap (config + plugin registration) must complete before the gateway starts");
  });

  test("the seller runtime starts only after the gateway is proven live and authenticated", () => {
    const src = supervisorSource();
    const waitIndex = src.indexOf("const ready = await waitForGatewayReady(env)");
    const sellerSpawnIndex = src.indexOf('spawnManaged(\n    "repodiet-seller-runtime"');
    assert.ok(waitIndex > -1 && sellerSpawnIndex > -1);
    assert.ok(waitIndex < sellerSpawnIndex, "communication prerequisites must be proven before the seller runtime starts");
  });

  test("BOTH plugins' real activation is verified after the gateway is ready and before the seller runtime starts", () => {
    const src = supervisorSource();
    const waitIndex = src.indexOf("const ready = await waitForGatewayReady(env)");
    const pluginListWaitIndex = src.indexOf("const pluginListOutcome = await waitForGatewayPluginListOrTimeout()");
    const okxVerifyIndex = src.indexOf("const okxA2aActive = verifyPluginActive(OKX_A2A_PLUGIN_ID");
    const bridgeVerifyIndex = src.indexOf("const bridgeActive = verifyPluginActive(REPODIET_BRIDGE_PLUGIN_ID");
    const sellerSpawnIndex = src.indexOf('spawnManaged(\n    "repodiet-seller-runtime"');
    assert.ok(waitIndex > -1 && pluginListWaitIndex > -1 && okxVerifyIndex > -1 && bridgeVerifyIndex > -1 && sellerSpawnIndex > -1);
    assert.ok(waitIndex < pluginListWaitIndex, "the gateway must be ready before waiting for its own plugin-list stdout line");
    assert.ok(pluginListWaitIndex < okxVerifyIndex && pluginListWaitIndex < bridgeVerifyIndex, "the plugin list must be awaited before checking activation against it");
    assert.ok(
      okxVerifyIndex < sellerSpawnIndex && bridgeVerifyIndex < sellerSpawnIndex,
      "a plugin file existing on disk is not readiness — genuine activation of BOTH plugins must be proven before the seller runtime starts"
    );
  });

  test("Incident #8: verifyPluginActive never spawns a second openclaw process — plugin activation is derived from the live Gateway's own stdout, not a CLI re-invocation proven to starve it of CPU", () => {
    const src = supervisorSource();
    assert.ok(
      !/runProcess\("openclaw",\s*\[\s*"plugins"/.test(src),
      "no code path may spawn `openclaw plugins ...` any more — proven live to starve the Gateway's CPU budget"
    );
    assert.ok(src.includes("export function verifyPluginActive(pluginId: string, requiredHook: string): boolean"));
    assert.ok(src.includes("parseGatewayListeningPluginIds"));
    assert.ok(src.includes("writePluginActivationProof"));
  });

  test("parseGatewayListeningPluginIds correctly parses the real traced Gateway startup-line format, including duration suffixes and the zero-plugin case", () => {
    assert.deepEqual(
      parseGatewayListeningPluginIds('{"msg":"http server listening (2 plugins: okx-a2a, repodiet-a2a-bridge; 1.2s)"}'),
      ["okx-a2a", "repodiet-a2a-bridge"]
    );
    assert.deepEqual(
      parseGatewayListeningPluginIds("http server listening (2 plugins: okx-a2a, repodiet-a2a-bridge)"),
      ["okx-a2a", "repodiet-a2a-bridge"]
    );
    assert.deepEqual(parseGatewayListeningPluginIds("http server listening (1 plugin: okx-a2a)"), ["okx-a2a"]);
    assert.deepEqual(parseGatewayListeningPluginIds("http server listening (0 plugins)"), []);
    assert.deepEqual(parseGatewayListeningPluginIds("http server listening (0 plugins, 0.4s)"), []);
    assert.equal(parseGatewayListeningPluginIds("some unrelated startup log line"), null);
  });

  test("parseGatewayListeningPluginIds survives a chunk boundary landing mid-line, via observeGatewayStdoutChunk's rolling tail", () => {
    resetGatewayLoadedPluginIdsForTests();
    assert.equal(getGatewayLoadedPluginIdsForTests(), null);
    observeGatewayStdoutChunk('{"msg":"http server listening (2 plugins: okx-a2a, repo');
    assert.equal(getGatewayLoadedPluginIdsForTests(), null, "must not guess from a partial line");
    observeGatewayStdoutChunk('diet-a2a-bridge; 1.2s)"}\n');
    assert.deepEqual(getGatewayLoadedPluginIdsForTests(), ["okx-a2a", "repodiet-a2a-bridge"]);
  });

  test("verifyPluginActive requires both the plugin to appear in the observed loaded-plugin list AND the hook to match what this boot's bootstrap actually configured", () => {
    resetGatewayLoadedPluginIdsForTests();
    assert.equal(verifyPluginActive(OKX_A2A_PLUGIN_ID, OKX_A2A_PLUGIN_HOOK), false, "must fail closed before the plugin list is ever observed");
    observeGatewayStdoutChunk("http server listening (2 plugins: okx-a2a, repodiet-a2a-bridge)\n");
    assert.equal(verifyPluginActive(OKX_A2A_PLUGIN_ID, OKX_A2A_PLUGIN_HOOK), true);
    assert.equal(verifyPluginActive(REPODIET_BRIDGE_PLUGIN_ID, REPODIET_BRIDGE_PLUGIN_HOOK), true);
    assert.equal(verifyPluginActive("some-other-plugin", OKX_A2A_PLUGIN_HOOK), false, "a plugin not in the observed list is never active");
    assert.equal(verifyPluginActive(OKX_A2A_PLUGIN_ID, "some-other-hook"), false, "a hook name that does not match what this boot configured must fail closed");
    resetGatewayLoadedPluginIdsForTests();
  });

  test("a genuine zero-plugin Gateway boot (the real '0 plugins' line) is distinguished from 'not observed yet' — both plugins correctly fail closed rather than being silently skipped", () => {
    resetGatewayLoadedPluginIdsForTests();
    observeGatewayStdoutChunk("http server listening (0 plugins)\n");
    assert.deepEqual(getGatewayLoadedPluginIdsForTests(), []);
    assert.equal(verifyPluginActive(OKX_A2A_PLUGIN_ID, OKX_A2A_PLUGIN_HOOK), false);
    resetGatewayLoadedPluginIdsForTests();
  });

  test("Incident #7: the openclaw CLI's RPC transport (proven, live, to hang indefinitely) is never spawned for readiness any more — the real Gateway is probed directly, in-process, via gateway-rpc-probe.ts's authenticated WebSocket client", () => {
    const src = supervisorSource();
    assert.ok(
      !/runProcess\("openclaw",\s*\[\s*"gateway"/.test(src),
      "no code path may spawn `openclaw gateway ...` any more — that CLI subprocess was proven to hang"
    );
    assert.ok(src.includes('import { probeGatewayRpc, type GatewayProbeResult } from "../src/lib/okx-runtime/gateway-rpc-probe"'));
    assert.ok(src.includes("async function gatewayAuthenticatedRpc"));
    assert.ok(!/--token["'`]?,?\s*(token|env\.OPENCLAW_GATEWAY_TOKEN)/.test(src), "the token must never be passed on a command line/argv");
  });

  test("the Gateway child's own stdout \"gateway ready\" milestone is watched only as a preliminary, bounded signal — never a substitute for the authenticated RPC probe succeeding", () => {
    const src = supervisorSource();
    assert.ok(src.includes("GATEWAY_STDOUT_READY_MARKER"));
    assert.ok(src.includes("GATEWAY_STDOUT_PRELIMINARY_WAIT_MS"));
    assert.ok(src.includes("export function observeGatewayStdoutChunk"));
    // waitForGatewayReadyWithDeps must call waitForStdoutReadyMarker() and then decide
    // readiness purely from probeOnce()'s own result — never short-circuit on the stdout
    // outcome alone. The strongest proof of this is the dedicated behavioral regression
    // test in test/seller-runtime-gateway-readiness.test.ts (dependency-injected, not
    // source-text matching), but the wiring itself is confirmed here.
    const fnMatch = src.match(/export async function waitForGatewayReadyWithDeps[\s\S]*?\n}\n/);
    assert.ok(fnMatch, "waitForGatewayReadyWithDeps must exist and be exported for direct behavioral testing");
    assert.ok(fnMatch![0].includes("deps.waitForStdoutReadyMarker()"));
    assert.ok(fnMatch![0].includes("deps.probeOnce()"));
    assert.ok(fnMatch![0].includes("if (result.ok)"), "readiness must be gated on the probe result, not the stdout outcome");
  });

  test("the readiness probe's connect timeout is configurable via an env var, matching the established pattern for this file's other tunable timeouts — there is only one now (no separate post-hello request phase, since the probe stops at hello-ok; see gateway-rpc-probe.ts)", () => {
    const src = supervisorSource();
    assert.ok(src.includes("REPODIET_OPENCLAW_GATEWAY_RPC_CONNECT_TIMEOUT_MS"));
    assert.ok(!src.includes("REPODIET_OPENCLAW_GATEWAY_RPC_REQUEST_TIMEOUT_MS"), "the removed post-hello request-phase timeout must not linger");
  });

  test("the overall gateway-ready deadline remains generous (5 minutes), so the polling loop still gets many real attempts even though each individual attempt is now fast (an in-process WS round-trip, not a CLI cold start)", () => {
    const src = supervisorSource();
    assert.ok(
      src.includes("REPODIET_OPENCLAW_GATEWAY_READY_TIMEOUT_MS || 300_000"),
      "the overall readiness deadline must remain generous"
    );
  });

  test("a failed readiness poll is logged with the probe's own categorized, already-redacted diagnostics, not a silent retry", () => {
    const src = supervisorSource();
    assert.ok(src.includes("gateway_rpc_not_ready_yet"));
    const failIndex = src.indexOf("gateway_rpc_not_ready_yet");
    const logCallStart = src.lastIndexOf("log(", failIndex);
    assert.ok(logCallStart > -1 && logCallStart < failIndex, "the failure must be logged via log(), not silently swallowed");
    const logCallSlice = src.slice(logCallStart, failIndex + 200);
    assert.ok(logCallSlice.includes("category"), "the probe's failure category must be logged");
    assert.ok(logCallSlice.includes("message"), "the probe's redacted failure message must be logged");
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
    const gatewaySpawn = src.match(/spawnManaged\(\s*"openclaw-gateway"[\s\S]{0,300}?\btrue,?[\s\S]{0,80}?\);/);
    const sellerSpawn = src.match(/spawnManaged\(\s*"repodiet-seller-runtime"[\s\S]{0,200}?\btrue\s*\);/);
    assert.ok(gatewaySpawn, "the gateway child must be spawned as required");
    assert.ok(sellerSpawn, "the seller-runtime child must be spawned as required");
  });

  test("startup fails closed (non-zero exit) at every hard prerequisite, never silently downgrading to unauthenticated", () => {
    const src = supervisorSource();
    for (const reason of [
      "openclaw_gateway_token_missing_or_too_short",
      "openclaw_bootstrap_failed",
      "openclaw_gateway_not_ready_within_timeout",
      "required_plugin_not_active",
    ]) {
      assert.ok(src.includes(reason), `missing fail-closed path for: ${reason}`);
    }
  });

  // --- Secret hygiene ------------------------------------------------------

  test("the token value itself is never passed to log()", () => {
    const src = supervisorSource();
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
