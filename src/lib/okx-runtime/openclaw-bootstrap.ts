/**
 * Safe, idempotent, version-aware bootstrap primitives for OpenClaw's
 * persisted config (`$HOME/.openclaw/openclaw.json`, where HOME is the
 * mounted /persistent/home volume — this file therefore survives
 * container restarts and redeploys, unlike anything on the image layer).
 *
 * Built after a real production incident: a concurrent diagnostic command
 * against a live container raced the supervisor's own `openclaw config
 * set` calls, and the SAME persisted config file kept failing every
 * `openclaw config set` on every subsequent restart — i.e. corruption (or
 * a bad concurrent write) on this file is not self-healing on its own,
 * because every restart just replays the same writes against the same
 * broken file. See docs/SELLER_RUNTIME_DEPLOYMENT.md for the full
 * incident writeup.
 *
 * Three primitives, each independently testable:
 *   - an exclusive bootstrap lock (acquireBootstrapLock/releaseBootstrapLock)
 *     so only one process ever writes OpenClaw config at a time;
 *   - config validation + quarantine-and-rebuild
 *     (validateOpenclawConfigFile/quarantineInvalidConfig) for a missing,
 *     empty, truncated, or invalid config file — never touching anything
 *     else under /persistent;
 *   - a version-aware bootstrap marker (readBootstrapMarker/
 *     writeBootstrapMarker/bootstrapMarkerMatches) so a healthy, unchanged
 *     restart can skip the config-set sequence entirely rather than
 *     re-running it (and its network-adjacent CLI calls) every boot.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface BootstrapVersions {
  onchainOsVersion: string;
  okxA2aVersion: string;
  openclawVersion: string;
  okxA2aOpenclawPluginVersion: string;
  pluginIds: string[];
  /** Hash of the exact config-set operation list this supervisor version writes — bumps whenever that list changes, forcing a fresh bootstrap even if every version string above is unchanged. */
  configSchemaHash: string;
}

export interface BootstrapMarker extends BootstrapVersions {
  writtenAt: string;
}

// --- Paths -------------------------------------------------------------

export function openclawHomeDir(env: NodeJS.ProcessEnv): string {
  return env.HOME?.trim() || path.join(process.cwd(), ".openclaw-home");
}

export function openclawConfigPath(env: NodeJS.ProcessEnv): string {
  return path.join(openclawHomeDir(env), ".openclaw", "openclaw.json");
}

export function bootstrapLockPath(env: NodeJS.ProcessEnv): string {
  return path.join(openclawHomeDir(env), ".openclaw", "repodiet-bootstrap.lock");
}

export function bootstrapMarkerPath(env: NodeJS.ProcessEnv): string {
  return path.join(openclawHomeDir(env), ".openclaw", "repodiet-bootstrap-marker.json");
}

/** See src/lib/okx-runtime/plugin-activation-proof.ts (Incident #8) for what this file proves and why it replaced a second `openclaw` CLI process. */
export function pluginActivationProofPath(env: NodeJS.ProcessEnv): string {
  return path.join(openclawHomeDir(env), ".openclaw", "repodiet-plugin-activation.json");
}

// --- Exclusive bootstrap lock --------------------------------------------

const STALE_LOCK_MS = 5 * 60_000;

export interface LockResult {
  acquired: boolean;
  reason?: "held_by_live_process" | "error";
  holderPid?: number;
}

/**
 * Exclusive, PID-based lock file. `wx` fails if the file already exists,
 * giving atomic create-if-absent semantics on a POSIX filesystem (the
 * persisted volume). A lock whose recorded PID is no longer alive, or
 * whose age exceeds STALE_LOCK_MS, is treated as abandoned and reclaimed —
 * mirrors the same stale-lock recovery already proven for the seller
 * runtime's own single-instance PID lock (src/lib/okx-runtime/runtime-layout.ts).
 */
export function acquireBootstrapLock(lockPath: string, pid: number = process.pid): LockResult {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  try {
    fs.writeFileSync(lockPath, JSON.stringify({ pid, acquiredAt: new Date().toISOString() }), {
      flag: "wx",
    });
    return { acquired: true };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
      return { acquired: false, reason: "error" };
    }
  }

  // Lock file already exists — check whether it is stale.
  try {
    const raw = fs.readFileSync(lockPath, "utf8");
    const holder = JSON.parse(raw) as { pid?: number; acquiredAt?: string };
    const holderAlive = typeof holder.pid === "number" && isProcessAlive(holder.pid);
    const ageMs = holder.acquiredAt ? Date.now() - Date.parse(holder.acquiredAt) : Infinity;
    if (holderAlive && ageMs < STALE_LOCK_MS) {
      return { acquired: false, reason: "held_by_live_process", holderPid: holder.pid };
    }
  } catch {
    // Unparseable lock file — treat as stale and reclaim below.
  }

  // Stale: reclaim by rewriting (best-effort; a genuine race here is
  // extremely unlikely given the age/liveness checks above, and the
  // consequence of losing a race is just a retried config-set, not data
  // loss).
  try {
    fs.writeFileSync(lockPath, JSON.stringify({ pid, acquiredAt: new Date().toISOString() }));
    return { acquired: true };
  } catch {
    return { acquired: false, reason: "error" };
  }
}

export function releaseBootstrapLock(lockPath: string, pid: number = process.pid): void {
  try {
    const raw = fs.readFileSync(lockPath, "utf8");
    const holder = JSON.parse(raw) as { pid?: number };
    if (holder.pid !== pid) return; // Not ours — never delete another holder's lock.
  } catch {
    // Unparseable — safe to remove, nothing coherent to preserve.
  }
  try {
    fs.rmSync(lockPath, { force: true });
  } catch {
    // Already gone.
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// --- Config validation + quarantine --------------------------------------

export type ConfigValidationState = "missing" | "valid" | "empty" | "invalid_json" | "invalid_shape";

export interface ConfigValidationResult {
  state: ConfigValidationState;
  detail: string;
}

/**
 * Validates without ever reading secret-shaped values into memory for
 * logging — only structural checks (parses as JSON, is a plain object).
 * OpenClaw's own config schema is large and evolving; this deliberately
 * does not attempt to fully re-validate it (that is OpenClaw's own job via
 * `openclaw config validate`) — it only needs to catch the failure modes
 * that break every subsequent `config set` call: missing, empty,
 * truncated, or not-a-JSON-object.
 */
export function validateOpenclawConfigFile(configPath: string): ConfigValidationResult {
  if (!fs.existsSync(configPath)) {
    return { state: "missing", detail: "config file does not exist yet" };
  }
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    return { state: "invalid_json", detail: `read failed: ${err instanceof Error ? err.message : "unknown_error"}` };
  }
  if (raw.trim().length === 0) {
    return { state: "empty", detail: "config file is empty" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { state: "invalid_json", detail: `JSON.parse failed: ${err instanceof Error ? err.message : "unknown_error"}` };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { state: "invalid_shape", detail: "parsed value is not a JSON object" };
  }
  return { state: "valid", detail: "config parses as a JSON object" };
}

/**
 * Renames — never deletes — a damaged config file to
 * `openclaw.json.corrupt-<timestamp>` beside itself, so a human can always
 * recover the exact bytes that were rejected. Only ever touches this one
 * file; never touches sibling directories (wallet credential state lives
 * elsewhere under the same HOME and must never be affected by this).
 */
export function quarantineInvalidConfig(configPath: string, now: Date = new Date()): string | null {
  if (!fs.existsSync(configPath)) return null;
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  const quarantinePath = `${configPath}.corrupt-${timestamp}`;
  fs.renameSync(configPath, quarantinePath);
  return quarantinePath;
}

// --- Version-aware bootstrap marker --------------------------------------

/**
 * Deterministic, non-secret hash of the exact set of config paths this
 * supervisor's bootstrap writes (not their values — SecretRef pointers
 * and literal mode strings only, matching the existing secret-hygiene
 * contract for buildOpenclawConfigCalls). Bumping the operation list
 * (adding/removing a config path) changes this hash, which is exactly
 * the "the config is invalid" / schema-drift trigger for a fresh
 * bootstrap even when every pinned version string is unchanged.
 */
export function computeConfigSchemaHash(configPaths: readonly string[]): string {
  return crypto.createHash("sha256").update(JSON.stringify([...configPaths].sort())).digest("hex").slice(0, 16);
}

export function readBootstrapMarker(markerPath: string): BootstrapMarker | null {
  try {
    const raw = fs.readFileSync(markerPath, "utf8");
    const parsed = JSON.parse(raw) as BootstrapMarker;
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Atomic write: write-then-rename, so a crash mid-write never leaves a truncated, unparseable marker. */
export function writeBootstrapMarker(markerPath: string, versions: BootstrapVersions): void {
  const marker: BootstrapMarker = { ...versions, writtenAt: new Date().toISOString() };
  const dir = path.dirname(markerPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.repodiet-bootstrap-marker.${process.pid}.tmp`);
  fs.writeFileSync(tmpPath, JSON.stringify(marker, null, 2), "utf8");
  fs.renameSync(tmpPath, markerPath);
}

/**
 * Bootstrap reruns unless every pinned version, the plugin id set, and the
 * config schema hash all match exactly — any drift (a version bump, a
 * plugin added/removed, a changed config-set operation list) is treated
 * as "stale", not partially trusted.
 */
export function bootstrapMarkerMatches(marker: BootstrapMarker | null, expected: BootstrapVersions): boolean {
  if (!marker) return false;
  return (
    marker.onchainOsVersion === expected.onchainOsVersion &&
    marker.okxA2aVersion === expected.okxA2aVersion &&
    marker.openclawVersion === expected.openclawVersion &&
    marker.okxA2aOpenclawPluginVersion === expected.okxA2aOpenclawPluginVersion &&
    marker.configSchemaHash === expected.configSchemaHash &&
    marker.pluginIds.length === expected.pluginIds.length &&
    marker.pluginIds.every((id, i) => id === expected.pluginIds[i])
  );
}
