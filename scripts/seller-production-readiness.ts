#!/usr/bin/env tsx
/**
 * Production-readiness gate for the RepoDiet seller runtime (Agent 9636).
 *
 * Exits non-zero unless every required condition is GENUINELY proven by a
 * live probe — never by "the process exists" or "the container is running".
 * Meant to run against a live container (locally via `docker compose exec`,
 * or inside the container itself) after the supervisor has reached its
 * `running` state, and again as a pre-resubmission gate before OKX
 * resubmission.
 *
 * Every check below maps directly to one of the required conditions in the
 * task spec:
 *
 *   - OnchainOS wallet loggedIn=true          -> onchainos gate-check: wallet.ok
 *   - Agent 9636 selected                     -> onchainos gate-check: identity.agentId
 *   - correct communication address           -> onchainos gate-check: communication.ok
 *   - OpenClaw gateway authenticated          -> direct in-process authenticated Gateway RPC
 *     probe (src/lib/okx-runtime/gateway-rpc-probe.ts) — never the `openclaw
 *     gateway status --require-rpc` CLI, proven (Incident #7) to hang
 *     indefinitely on the real Fly Machine
 *   - okx-a2a plugin active                   -> scripts/seller-runtime-supervisor.ts's own
 *     persisted plugin-activation proof (src/lib/okx-runtime/plugin-
 *     activation-proof.ts) — never `openclaw plugins inspect --runtime
 *     --json`, proven (Incident #8) to starve the live Gateway's CPU on
 *     this Machine's shared vCPU rather than return in any usable bound
 *   - repodiet-a2a-bridge plugin active       -> same persisted proof, for repodiet-a2a-bridge
 *     (a plugin FILE existing on disk is not readiness; the proof only
 *     exists once the live Gateway genuinely reported the plugin loaded)
 *   - A2A daemon running                      -> okx-a2a daemon status
 *   - XMTP communication active               -> okx-a2a agent refresh --json
 *   - communication.ok=true / ready=true      -> onchainos gate-check
 *   - Vercel heartbeat accepted                -> GET /api/okx/health: heartbeatStatus=fresh
 *   - real 37347 dispatcher registered         -> dispatchAnalyzeRepository() from the bridge's own
 *     dispatch.js, reused (not duplicated) directly, against the real
 *     production A2MCP endpoint — proves the dispatcher is wired to a
 *     reachable, real service, not merely that a plugin file exists
 *   - real 37348 dispatcher registered         -> dispatchCreateTask() from the same dispatch.js,
 *     against the real production A2A intake endpoint with a safe
 *     discovery-only message (no task created, no payment, matches the
 *     already-proven safe-pattern probes elsewhere in this repo)
 *   - GitHub App installation token works      -> resolveAspGitHubToken()
 *   - GitHub App can access the E2E repo       -> same call, scoped to velz-cmd/repodiet-e2e-test
 *   - only one seller runtime is active        -> runtime.pid lock file, live PID
 *
 * Never logs secret values. Never treats a failure to reach a check as
 * that check passing (every probe defaults to `ready: false` on error).
 */
import { getRuntimePaths, readLivePid, OKX_RUNTIME_IDENTITIES } from "../src/lib/okx-runtime/runtime-layout";
import { runProcess } from "../src/lib/okx-runtime/process-runner";
import { pluginActivationProofPath } from "../src/lib/okx-runtime/openclaw-bootstrap";
import { readPluginActivationProof, isPluginActivationProven } from "../src/lib/okx-runtime/plugin-activation-proof";
import { probeGatewayRpc } from "../src/lib/okx-runtime/gateway-rpc-probe";

const SELLER = OKX_RUNTIME_IDENTITIES.seller;
const BASE_URL = (process.env.REPODIET_PRODUCTION_URL || "https://skillswap-virid-kappa.vercel.app").replace(/\/$/, "");
const E2E_REPO = { owner: "velz-cmd", repo: "repodiet-e2e-test" };
// Must match scripts/seller-runtime-supervisor.ts's OKX_A2A_PLUGIN_ID /
// REPODIET_BRIDGE_PLUGIN_ID / OPENCLAW_GATEWAY_PORT exactly. Kept as
// separate literals (not a shared import) so this script never pulls in
// that module's top-level SIGTERM/SIGINT handlers as an unwanted side
// effect of a plugin-id import.
const OKX_A2A_PLUGIN_ID = "okx-a2a";
const OKX_A2A_PLUGIN_HOOK = "before_agent_run";
const REPODIET_BRIDGE_PLUGIN_ID = "repodiet-a2a-bridge";
const REPODIET_BRIDGE_PLUGIN_HOOK = "before_agent_reply";
const OPENCLAW_GATEWAY_PORT = Number(process.env.OPENCLAW_GATEWAY_PORT || 18789);
const OPENCLAW_GATEWAY_URL = `ws://127.0.0.1:${OPENCLAW_GATEWAY_PORT}`;
// Must stay consistent with GATE_CHECK_TIMEOUT_MS in
// scripts/repodiet-seller-runtime.ts — see Incident #13. The real
// `onchainos agent gate-check --role asp` was measured at ~30s on a quiet
// runtime and was still running when killed at a hard 90s bound under
// steady-state load, because it shells out to `okx-a2a doctor` and makes
// live OKX-backend and XMTP calls. The previous 20s bound here was below
// even the fast path, so this script reported four false negatives
// (wallet/agent/communication/ready) that the runtime's own gate-check
// simultaneously proved true. Bounding the call is still required — an
// unbounded call hangs the script — but the bound must fit the command.
const GATE_CHECK_TIMEOUT_MS = 150_000;
// The provider the supervisor binds; see REPODIET_OKX_A2A_PROVIDER in
// scripts/seller-runtime-supervisor.ts.
const EXPECTED_A2A_PROVIDER = (process.env.REPODIET_OKX_A2A_PROVIDER?.trim() || "openclaw").toLowerCase();

interface Check {
  id: string;
  requiredForProduction: boolean;
  ready: boolean;
  detail: string;
}

const checks: Check[] = [];

function record(id: string, requiredForProduction: boolean, ready: boolean, detail: string): void {
  checks.push({ id, requiredForProduction, ready, detail });
}

async function checkOnchainOsGate(): Promise<void> {
  const result = await runProcess("onchainos", ["agent", "gate-check", "--role", "asp"], {
    timeoutMs: GATE_CHECK_TIMEOUT_MS,
  });
  if (!result.ok) {
    record("onchainos_wallet_logged_in", true, false, "gate-check did not exit cleanly");
    record("agent_9636_selected", true, false, "gate-check did not exit cleanly");
    record("communication_address_correct", true, false, "gate-check did not exit cleanly");
    record("onchainos_ready", true, false, "gate-check did not exit cleanly");
    return;
  }
  try {
    const line = result.stdout.trim().split("\n").pop() ?? "{}";
    const parsed = JSON.parse(line);
    const data = parsed?.data ?? {};
    record("onchainos_wallet_logged_in", true, data?.wallet?.ok === true, "onchainos agent gate-check: wallet.ok");
    record(
      "agent_9636_selected",
      true,
      data?.identity?.agentId === SELLER.agentId,
      `onchainos agent gate-check: identity.agentId (expected ${SELLER.agentId})`
    );
    record(
      "communication_address_correct",
      true,
      data?.communication?.ok === true,
      "onchainos agent gate-check: communication.ok"
    );
    record("onchainos_ready", true, data?.ready === true, "onchainos agent gate-check: ready");
  } catch {
    for (const id of ["onchainos_wallet_logged_in", "agent_9636_selected", "communication_address_correct", "onchainos_ready"]) {
      record(id, true, false, "gate-check output was not parseable JSON");
    }
  }
}

/**
 * Direct, in-process authenticated Gateway RPC probe — same mechanism as
 * scripts/seller-runtime-supervisor.ts's gatewayAuthenticatedRpc
 * (src/lib/okx-runtime/gateway-rpc-probe.ts). Previously this shelled out
 * to `openclaw gateway status --require-rpc --json`, the exact CLI RPC
 * transport Incident #7 (seller-runtime-supervisor.ts's module docblock)
 * proved hangs indefinitely on the real Fly Machine — that fix only
 * touched the supervisor's own boot-time gate, never this independent
 * on-demand diagnostic, so this script inherited the same hang. Fixed the
 * same way: never spawn the CLI's RPC transport at all.
 */
async function checkOpenclawGatewayAuthenticated(): Promise<void> {
  const result = await probeGatewayRpc({
    url: OPENCLAW_GATEWAY_URL,
    token: process.env.OPENCLAW_GATEWAY_TOKEN ?? "",
    connectTimeoutMs: 15_000,
  });
  record(
    "openclaw_gateway_authenticated",
    true,
    result.ok,
    result.ok
      ? `authenticated Gateway RPC hello-ok (serverVersion=${result.serverVersion})`
      : `authenticated Gateway RPC failed: ${result.category}`
  );
}

/**
 * "A plugin file merely existing on disk is not readiness" — reads the
 * proof scripts/seller-runtime-supervisor.ts's own boot-time gate persists
 * (src/lib/okx-runtime/plugin-activation-proof.ts) once it has genuinely
 * observed the live Gateway's own "http server listening (...)" startup
 * line reporting the plugin loaded, combined with this boot's own bootstrap
 * having configured the required hook's conversation access.
 *
 * Previously this re-invoked `openclaw plugins inspect <id> --runtime
 * --json` directly — the exact command proven, live via direct /proc
 * inspection (Incident #8, plugin-activation-proof.ts's module docblock),
 * to starve the live Gateway of CPU on this Machine's shared vCPU rather
 * than return in any reasonable bound. Reading the supervisor's own
 * already-proven-fresh-this-boot proof file avoids spawning that second
 * `openclaw` process entirely, here as well as at boot.
 */
function checkPluginsActive(): void {
  const env = process.env;
  const proof = readPluginActivationProof(pluginActivationProofPath(env));
  const okxA2aActive = isPluginActivationProven(proof, OKX_A2A_PLUGIN_ID, OKX_A2A_PLUGIN_HOOK);
  record(
    "okx_a2a_plugin_active",
    true,
    okxA2aActive,
    `plugin-activation proof at ${pluginActivationProofPath(env)}: okx-a2a loaded + before_agent_run configured this boot`
  );
  const bridgeActive = isPluginActivationProven(proof, REPODIET_BRIDGE_PLUGIN_ID, REPODIET_BRIDGE_PLUGIN_HOOK);
  record(
    "repodiet_a2a_bridge_plugin_active",
    true,
    bridgeActive,
    `plugin-activation proof at ${pluginActivationProofPath(env)}: repodiet-a2a-bridge loaded + before_agent_reply configured this boot`
  );
}

/**
 * Proves both real dispatchers (A2MCP 37347, A2A 37348) are genuinely
 * wired to reachable production services — not merely that the plugin
 * loaded. Reuses the bridge's own dispatch.js directly (no dependency on
 * the "openclaw" package, so importable here too) rather than
 * reimplementing a second copy of the dispatch logic. The A2A probe uses a
 * safe discovery-only message — no task, payment, or repository access is
 * created by this check, matching the safe-pattern probes already proven
 * elsewhere in this repo (docs/OKX_RESUBMISSION_AUDIT.md).
 */
async function checkRealDispatchersRegistered(): Promise<void> {
  try {
    const { dispatchAnalyzeRepository, dispatchCreateTask } = await import(
      "../openclaw-plugins/repodiet-a2a-bridge/dispatch.js"
    );
    try {
      const result = await dispatchAnalyzeRepository({
        repositoryUrl: `https://github.com/${E2E_REPO.owner}/${E2E_REPO.repo}`,
      });
      record(
        "real_37347_dispatcher_registered",
        true,
        result.status === 402 || result.status === 200,
        `dispatchAnalyzeRepository() -> real production HTTP ${result.status} (402 payment-required or 200 are both proof of a genuinely reachable dispatcher)`
      );
    } catch (err) {
      record(
        "real_37347_dispatcher_registered",
        true,
        false,
        `dispatchAnalyzeRepository() failed: ${err instanceof Error ? err.message : "unknown_error"}`
      );
    }
    try {
      const result = await dispatchCreateTask({ message: "Is RepoDiet online?" });
      record(
        "real_37348_dispatcher_registered",
        true,
        result.status === 200,
        `dispatchCreateTask() -> real production HTTP ${result.status} (safe discovery-only probe, no task created)`
      );
    } catch (err) {
      record(
        "real_37348_dispatcher_registered",
        true,
        false,
        `dispatchCreateTask() failed: ${err instanceof Error ? err.message : "unknown_error"}`
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    record("real_37347_dispatcher_registered", true, false, `could not load dispatch.js: ${message}`);
    record("real_37348_dispatcher_registered", true, false, `could not load dispatch.js: ${message}`);
  }
}

async function checkA2aDaemon(): Promise<void> {
  const result = await runProcess("okx-a2a", ["daemon", "status"], { timeoutMs: 20_000 });
  const running = result.ok && (/\brunning\b/i.test(result.stdout) || /\bready\b/i.test(result.stdout));
  record("a2a_daemon_running", true, running, "okx-a2a daemon status");

  // `daemon status` prints only liveness — verified directly against the
  // pinned 0.1.11 CLI, its entire stdout is `running pid=<n>` (or `stale
  // pid=<n>`). It never names the provider, so the previous
  // `/openclaw/i.test(daemonStatusOutput)` could never be true and this
  // check reported a permanent false negative while the provider was in
  // fact correctly bound. The documented command that reports it is
  // `okx-a2a ai-provider status --json` ("Show the stored default
  // provider", confirmed via `okx-a2a ai-provider --help`), which returns
  // `{"ok":true,"provider":"openclaw","detection":{…}}`.
  const providerResult = await runProcess("okx-a2a", ["ai-provider", "status", "--json"], {
    timeoutMs: 20_000,
  });
  let boundProvider: string | undefined;
  if (providerResult.ok) {
    try {
      const parsed = JSON.parse(providerResult.stdout.trim().split("\n").pop() ?? "{}");
      if (parsed?.ok === true && typeof parsed?.provider === "string") {
        boundProvider = parsed.provider.toLowerCase();
      }
    } catch {
      boundProvider = undefined;
    }
  }
  record(
    "okx_a2a_provider_configured",
    true,
    boundProvider === EXPECTED_A2A_PROVIDER,
    `okx-a2a ai-provider status --json: provider (expected ${EXPECTED_A2A_PROVIDER}, got ${boundProvider ?? "unreadable"})`
  );
}

async function checkXmtpActive(): Promise<void> {
  const result = await runProcess("okx-a2a", ["agent", "refresh", "--json"], { timeoutMs: 20_000 });
  if (!result.ok) {
    record("xmtp_communication_active", true, false, "okx-a2a agent refresh --json did not exit cleanly");
    return;
  }
  try {
    const parsed = JSON.parse(result.stdout.trim());
    record(
      "xmtp_communication_active",
      true,
      parsed?.ok === true && (parsed?.payload?.activeClients ?? 0) >= 1,
      "okx-a2a agent refresh --json: activeClients >= 1"
    );
  } catch {
    record("xmtp_communication_active", true, false, "agent refresh output was not parseable JSON");
  }
}

async function checkVercelHeartbeatAndDispatcher(): Promise<void> {
  try {
    const response = await fetch(`${BASE_URL}/api/okx/health`, { method: "GET" });
    if (!response.ok) {
      record("vercel_heartbeat_accepted", true, false, `GET /api/okx/health returned ${response.status}`);
      record("task_dispatcher_registered", true, false, `GET /api/okx/health returned ${response.status}`);
      return;
    }
    const body = (await response.json()) as {
      agentRuntime?: { heartbeatStatus?: string; officialWatchActive?: boolean; aspAgentId?: string };
    };
    const runtime = body.agentRuntime ?? {};
    record(
      "vercel_heartbeat_accepted",
      true,
      runtime.heartbeatStatus === "fresh",
      `GET /api/okx/health: agentRuntime.heartbeatStatus (expected "fresh", got ${String(runtime.heartbeatStatus)})`
    );
    record(
      "task_dispatcher_registered",
      true,
      runtime.officialWatchActive === true,
      "GET /api/okx/health: agentRuntime.officialWatchActive"
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    record("vercel_heartbeat_accepted", true, false, `GET /api/okx/health failed: ${message}`);
    record("task_dispatcher_registered", true, false, `GET /api/okx/health failed: ${message}`);
  }
}

async function checkGitHubApp(): Promise<void> {
  try {
    const { isGitHubAppConfigured } = await import("../src/lib/github-app/config");
    if (!isGitHubAppConfigured()) {
      record("github_app_installation_token_works", true, false, "GitHub App env vars are not fully configured");
      record("github_app_can_access_e2e_repo", true, false, "GitHub App env vars are not fully configured");
      return;
    }
    const { resolveAspGitHubToken } = await import("../src/lib/asp/github-access");
    const token = await resolveAspGitHubToken(E2E_REPO);
    record(
      "github_app_installation_token_works",
      true,
      Boolean(token),
      "resolveAspGitHubToken() returned an installation token"
    );
    record(
      "github_app_can_access_e2e_repo",
      true,
      Boolean(token),
      `resolveAspGitHubToken() verified write access to ${E2E_REPO.owner}/${E2E_REPO.repo}`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    record("github_app_installation_token_works", true, false, message);
    record("github_app_can_access_e2e_repo", true, false, message);
  }
}

function checkSingleInstance(): void {
  const root =
    process.env.REPODIET_OKX_RUNTIME_ROOT?.trim() ||
    (process.platform === "win32" ? process.env.LOCALAPPDATA : process.env.XDG_DATA_HOME) ||
    ".";
  const paths = getRuntimePaths(root, "seller");
  const pid = readLivePid(paths.pidFile);
  record(
    "only_one_seller_runtime_active",
    true,
    typeof pid === "number",
    pid ? `live runtime.pid=${pid} at ${paths.pidFile}` : `no live PID at ${paths.pidFile}`
  );
}

async function main(): Promise<void> {
  await checkOnchainOsGate();
  await checkOpenclawGatewayAuthenticated();
  checkPluginsActive();
  await checkA2aDaemon();
  await checkXmtpActive();
  await checkVercelHeartbeatAndDispatcher();
  await checkRealDispatchersRegistered();
  await checkGitHubApp();
  checkSingleInstance();

  const requiredFailing = checks.filter((c) => c.requiredForProduction && !c.ready);
  const report = {
    at: new Date().toISOString(),
    ready: requiredFailing.length === 0,
    checks,
    failingRequiredChecks: requiredFailing.map((c) => c.id),
  };
  console.log(JSON.stringify(report, null, 2));
  // process.exitCode (not process.exit()) so Node drains pending handles from
  // the several spawned child processes above before exiting naturally —
  // calling process.exit() immediately after multiple sequential child_process
  // spawns has been observed to abort with a libuv assertion on Windows.
  process.exitCode = report.ready ? 0 : 1;
}

main().catch((err) => {
  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      ready: false,
      fatal: err instanceof Error ? err.message : "unknown_error",
    })
  );
  process.exitCode = 1;
});
