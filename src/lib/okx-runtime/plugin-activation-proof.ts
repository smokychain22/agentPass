/**
 * Persisted, boot-time proof that both required OpenClaw plugins genuinely
 * loaded into the live Gateway process — replaces re-invoking
 * `openclaw plugins inspect <id> --runtime --json` as a second, separate
 * `openclaw` process.
 *
 * === Incident #8: the CLI-spawned plugin-inspection check itself proven
 * to starve the live Gateway on repodiet-agent-9636's shared-cpu-1x/512MB
 * Machine ===
 * `openclaw plugins inspect <id> --runtime --json` (used by both
 * scripts/seller-runtime-supervisor.ts's boot-time gate and
 * scripts/seller-production-readiness.ts's independent re-check) was
 * proven, live, via direct SSH `/proc` inspection, to run for 90+ seconds
 * without completing — even its `--json`-only, non-`--runtime` snapshot
 * variant, which per the CLI's own source (`plugins-inspect-command-
 * DRp1IKYf.js`) shares no code path with `--runtime`'s "runtime plugin
 * registry load" beyond a common `config read` / `install records load`
 * prefix. `/proc/<pid>/status` showed the process in state `R` (actively
 * running, not blocked) with `utime` genuinely accumulating, and
 * `/proc/net/tcp`/`tcp6` showed no outbound connection attributable to it —
 * ruling out both a network stall and a lock/IO block. The conclusion:
 * spawning a second, full `openclaw` runtime process (which reloads a
 * large chunk of the same module graph and plugin registry the live
 * Gateway already has resident) is simply too heavy to run concurrently
 * with the live Gateway on a single shared vCPU with ~130MB of headroom
 * out of 512MB total — not a deadlock, but resource starvation severe
 * enough to be indistinguishable from one at any timeout short of minutes,
 * and unsafe to run at all given the risk of starving the live Gateway's
 * own event loop (heartbeats, XMTP) of CPU while it runs. See
 * docs/SELLER_RUNTIME_DEPLOYMENT.md ("Incident #8") for the full writeup.
 *
 * The fix: never spawn a second `openclaw` process for this. The
 * supervisor already watches the Gateway child's own stdout for the
 * "gateway ready" milestone (Incident #7); it also watches for the
 * Gateway's own real startup summary line, traced directly from
 * `node_modules/openclaw/dist/server-startup-log-mxipLyo5.js`:
 *
 *   `http server listening (${pluginSummary})`
 *
 * where `pluginSummary` is built by `formatReadyDetails` from
 * `pluginRegistry.plugins.filter(p => p.status === "loaded").map(p =>
 * p.id)` (traced from `server-startup-post-attach-B3O9knW5.js`) — i.e. the
 * SAME live Gateway process's own authoritative plugin registry, sorted
 * and joined, e.g. `"http server listening (2 plugins: okx-a2a,
 * repodiet-a2a-bridge; 1.2s)"` or `"http server listening (0 plugins)"`.
 *
 * `status === "loaded"` (traced from `loader-D8d2EvVh.js`:
 * `status: params.enabled ? "loaded" : "disabled"`, and separately
 * `record.status = "error"` wherever the plugin's own module import
 * throws) proves the plugin module genuinely executed without error — a
 * stronger proof than file existence. It does not, on its own, prove the
 * plugin's specific hook registered (that requires `activated === true`
 * plus membership in `registry.typedHooks`, populated only when
 * `api.on(hookName, handler)` actually runs inside the plugin's own
 * `register()` — traced into `registry-B8eQDFB4.js` — and NOT surfaced on
 * stdout anywhere: hook-registration-blocked diagnostics are pushed only
 * into an in-memory `registry.diagnostics` array, never logged). That gap
 * is closed by construction, not by re-deriving it from the live process:
 * `runBootstrap` is a hard precondition for the Gateway ever starting, and
 * it only completes successfully after `openclaw config set` for
 * `plugins.entries.<id>.hooks.allowConversationAccess=true` (both plugin
 * ids, `buildOpenclawConfigBatch`) was applied AND
 * `validateOpenclawConfigFile` confirmed the persisted config file is
 * valid — the exact precondition typed-hook registration for a
 * conversation-scoped hook (`isConversationHookName`) checks. Together,
 * "the plugin's module loaded without error" (proven live, from the
 * Gateway's own process) plus "the config that gates this hook's
 * registration was proven applied before the Gateway ever started" (proven
 * by this supervisor's own bootstrap, independently tested) cover the same
 * failure modes the CLI's `typedHooks` enumeration covered, without a
 * second concurrent runtime instantiation.
 */
import fs from "node:fs";
import path from "node:path";

export interface PluginActivationProof {
  writtenAt: string;
  /** The live Gateway's own reported loaded-plugin-id list, verbatim from its "http server listening (...)" startup line. */
  loadedPluginIds: string[];
  /** pluginId -> hook name this boot's bootstrap configured `allowConversationAccess=true` for (buildOpenclawConfigBatch) — recorded, not re-derived, so a caller's expected hook name is checked against what was actually configured this boot. */
  configuredHooks: Record<string, string>;
}

/**
 * Parses the Gateway's real "http server listening (...)" startup line,
 * traced verbatim from `formatReadyDetails` in
 * `node_modules/openclaw/dist/server-startup-log-mxipLyo5.js`. Matches
 * anywhere within a larger string (the caller may pass a rolling stdout
 * buffer, not a single clean line) so it survives an arbitrary chunk
 * boundary landing mid-line. Returns `null` when the line has not
 * appeared yet — never an empty array, which is reserved for the real
 * "0 plugins" case so callers can tell "not seen yet" from "genuinely
 * zero plugins loaded".
 */
export function parseGatewayListeningPluginIds(buffer: string): string[] | null {
  const outer = buffer.match(/http server listening \(([^)]*)\)/);
  if (!outer) return null;
  const inner = outer[1];
  if (/^0 plugins\b/.test(inner)) return [];
  const withIds = inner.match(/^\d+ plugins?: ([^;]+?)(?:;.*)?$/);
  if (!withIds) return null;
  return withIds[1]
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

/** Atomic write: write-then-rename, so a crash mid-write never leaves a truncated, unparseable proof file. */
export function writePluginActivationProof(proofPath: string, proof: PluginActivationProof): void {
  const dir = path.dirname(proofPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.repodiet-plugin-activation.${process.pid}.tmp`);
  fs.writeFileSync(tmpPath, JSON.stringify(proof, null, 2), "utf8");
  fs.renameSync(tmpPath, proofPath);
}

export function readPluginActivationProof(proofPath: string): PluginActivationProof | null {
  try {
    const raw = fs.readFileSync(proofPath, "utf8");
    const parsed = JSON.parse(raw) as PluginActivationProof;
    if (typeof parsed !== "object" || parsed === null) return null;
    if (!Array.isArray(parsed.loadedPluginIds)) return null;
    if (typeof parsed.configuredHooks !== "object" || parsed.configuredHooks === null) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * True only when the live Gateway's own reported plugin list includes
 * `pluginId` AND this boot's bootstrap configured `requiredHook` (not some
 * other hook name) as the conversation-access-enabled hook for it — a
 * mismatch here means the caller's expectation and what was actually
 * configured this boot have drifted, which must fail closed rather than
 * silently pass.
 */
export function isPluginActivationProven(
  proof: PluginActivationProof | null,
  pluginId: string,
  requiredHook: string
): boolean {
  if (!proof) return false;
  if (!proof.loadedPluginIds.includes(pluginId)) return false;
  return proof.configuredHooks[pluginId] === requiredHook;
}
