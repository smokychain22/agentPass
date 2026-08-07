import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execa } from "execa";
import { detectPackageManager } from "@/lib/scanner/detect-package-manager";
import type { PackageManager } from "@/lib/scanner/types";
import { isServerlessRuntime } from "@/lib/server/runtime-env";
import {
  assertVerificationInstallCommand,
  buildVerificationInstallCommands,
  verificationInstallEnv,
} from "@/lib/execution/package-manager-adapter";
import {
  prepareCleanInstallWorkspace,
  prepareNpmCacheDir,
} from "@/lib/execution/verification-workspace";

const INSTALL_TIMEOUT_MS = 180_000;
const MAX_ATTEMPTS = 4;
const CACHE_RETRY_MAX = 2;
/** Grace between SIGTERM and SIGKILL for an install that ignores the first. */
const INSTALL_KILL_GRACE_MS = 5_000;

/**
 * Drops a heavy child to the lowest scheduling priority.
 *
 * === Incident #22: one verification run starved the live agent ===
 *
 * Measured on the production Machine (shared-cpu-1x, 2 GB) on 2026-08-07. A
 * SINGLE cleanup attempt for the funded job — `npm install` followed by
 * `next build` and its jest-worker children — drove the 1-vCPU box to load
 * 11+. The seller runtime's own liveness calls (`okx-a2a daemon status`,
 * `agent refresh`, and the `okx-a2a doctor` behind `gate-check`) are light but
 * latency-sensitive, and they lost the CPU race for the whole run: the 150s
 * gate-check timed out repeatedly and the agent withheld its heartbeat for the
 * entire ~20-minute window with `daemonOk:true` and `xmtpOk:true`.
 *
 * Bounding and quarantining the job (Incidents #18/#21) stops it running
 * CONTINUOUSLY, which was the larger problem. This addresses what remains: for
 * as long as one permitted attempt does run, it must not outrank the agent's
 * ability to prove it is alive.
 *
 * `nice` is exactly the right instrument. The heavy work is throughput-bound
 * and nobody is waiting on it interactively, so yielding the CPU whenever the
 * runtime needs it costs the cleanup a little wall-clock and buys the agent its
 * liveness back. Priority is applied to the child, never to the runtime itself
 * — deprioritising the runtime would slow the very heartbeat this protects.
 *
 * Best-effort by design: unsupported platforms and races where the child has
 * already exited are ignored, because failing to renice must never fail an
 * install.
 */
export function deprioritize(pid: number | undefined, label: string): void {
  if (pid === undefined) return;
  try {
    // 19 = lowest. The runtime stays at its default 0 and therefore always
    // preempts this work.
    os.setPriority(pid, 19);
  } catch {
    void label; // renice is advisory; never let it break the pipeline
  }
}

/**
 * Runs one install command under a timeout that kills the ENTIRE process
 * group, so nothing the package manager spawned can outlive the deadline.
 *
 * === Why execa's own `timeout` is not enough ===
 *
 * `execa`'s `timeout` signals the direct child only. `npm ci` / `npm install`
 * is not a leaf process: it forks workers and (for package managers that honour
 * lifecycle scripts) arbitrary child processes of its own. A timed-out install
 * therefore left grandchildren running, reparented to init.
 *
 * This is the exact defect already fixed once on this machine for the
 * gate-check path (`runBoundedGroup` in scripts/repodiet-seller-runtime.ts):
 * three leaked `okx-a2a doctor` grandchildren had accumulated on
 * repodiet-agent-9636, each holding a Node heap on a 1-vCPU box, driving load
 * average past 14 and starving the very command that spawned them. The
 * repository-verification path spawns strictly heavier children than that and
 * had no equivalent protection at all — on a 2 GB machine a single leaked
 * install is enough to reach the OOM killer.
 *
 * `detached: true` puts the child in its own process group (pgid === pid), so
 * `kill(-pgid)` takes down the child and everything beneath it.
 *
 * The returned shape is exactly execa's, including `timedOut` and `signal`, so
 * `describeProcessTermination` keeps reporting OOM-vs-timeout-vs-conflict the
 * same way. `reject: false` is preserved: callers inspect `exitCode`.
 */
async function runBoundedInstall(
  command: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs?: number }
): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
  signal?: string | null;
  timedOut?: boolean;
}> {
  const timeoutMs = options.timeoutMs ?? INSTALL_TIMEOUT_MS;
  // Process groups are POSIX. On Windows `detached` creates a new console
  // rather than a killable group, so the platform's own child-tree handling
  // (and execa's timeout) is used there instead.
  const useProcessGroup = process.platform !== "win32";

  const child = execa(command[0], command.slice(1), {
    cwd: options.cwd,
    env: options.env,
    reject: false,
    detached: useProcessGroup,
    // Retained as a backstop for the direct child; the group kill below is
    // what actually bounds the tree.
    timeout: useProcessGroup ? undefined : timeoutMs,
  });

  deprioritize(child.pid, "install");

  let timedOut = false;
  const killGroup = (signal: NodeJS.Signals) => {
    if (child.pid === undefined) return;
    try {
      if (useProcessGroup) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch {
      try {
        child.kill(signal);
      } catch {
        /* already exited */
      }
    }
  };

  const timer = useProcessGroup
    ? setTimeout(() => {
        timedOut = true;
        killGroup("SIGTERM");
        setTimeout(() => killGroup("SIGKILL"), INSTALL_KILL_GRACE_MS).unref?.();
      }, timeoutMs)
    : undefined;
  timer?.unref?.();

  try {
    const result = await child;
    return {
      exitCode: result.exitCode ?? null,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      signal: result.signal ?? null,
      // Our own group kill is authoritative; execa only knows about its own.
      timedOut: timedOut || result.timedOut === true,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface WorkspaceInstallResult {
  installed: boolean;
  partial?: boolean;
  reason?: string;
  command?: string;
  exitCode?: number | null;
  durationMs?: number;
  stdout?: string;
  stderr?: string;
}

export interface InstallAttemptRecord {
  command: string;
  attempt: number;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

function summarize(text: string, max = 280): string {
  const sanitized = sanitizeInstallOutput(text);
  const trimmed = sanitized.trim();
  if (!trimmed) return "";
  const withoutWarnings = trimmed
    .split("\n")
    .filter((line) => !/^\s*npm warn\b/i.test(line))
    .join("\n")
    .trim();
  const source = withoutWarnings || trimmed;
  return source.length > max ? `${source.slice(0, max)}…` : source;
}

/** Drop npm debug noise and binary buffer dumps — never show these in the UI. */
export function isNpmLogNoiseLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (/<Buffer[\s\S]*>/i.test(trimmed)) return true;
  if (/\.\.\.\s*\d+\s+more bytes>/i.test(trimmed)) return true;
  if (/^\d+\s+(silly|http|verbose|timing|info)\b/i.test(trimmed)) return true;
  if (/^\d+\s+silly tar\b/i.test(trimmed)) return true;
  if (/^[0-9a-f]{2}(\s+[0-9a-f]{2}){12,}/i.test(trimmed)) return true;
  if (trimmed.startsWith("npm error A complete log of this run can be found in:")) return true;
  if (trimmed.startsWith("npm notice")) return true;
  /**
   * `npm warn` is NOT a failure. npm emits it on completely healthy installs
   * (deprecated transitive deps, config defaults), so it must never be
   * eligible to become a failure reason.
   *
   * Observed in production on the Fly runtime: a dependency install failed for
   * an unrelated reason, `formatInstallFailureReason` found no `npm error`
   * line and no parseable debug log, and its last-resort fallback returned the
   * final lines of output — which were warnings. The verification check then
   * reported `npm warn config … npm warn deprecated left-pad@1.3.0` as the
   * cause, which propagated all the way into the delivery gate's
   * NO_SAFE_CANDIDATES message and masked the real failure.
   *
   * A warn line carrying a genuinely fatal marker (ENOSPC / EROFS / no space
   * left) is deliberately NOT suppressed: npm normally reports those at error
   * level, but if it ever reports one at warn level it must still be able to
   * reach the error matchers rather than be discarded as noise.
   */
  if (/^npm\s+warn\b/i.test(trimmed) && !/\b(ENOSPC|EROFS)\b|no space left/i.test(trimmed)) {
    return true;
  }
  return false;
}

export function sanitizeInstallOutput(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !isNpmLogNoiseLine(line))
    .join("\n");
}

/** Parse numbered npm debug log lines (`1234 error …`) into human-readable messages. */
export function parseNpmDebugLog(raw: string): string[] {
  const actionable: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || isNpmLogNoiseLine(trimmed)) continue;

    const levelMatch = trimmed.match(/^\d+\s+error\s+(.+)$/i);
    if (levelMatch) {
      actionable.push(levelMatch[1]!.replace(/^npm error\s*/i, ""));
      continue;
    }

    if (/^\d+\s+warn\s+.*\b(ENOSPC|EROFS|no space left)/i.test(trimmed)) {
      actionable.push(trimmed.replace(/^\d+\s+warn\s+\S+\s+/, ""));
      continue;
    }

    if (trimmed.startsWith("npm error")) {
      actionable.push(trimmed.replace(/^npm error\s*/i, ""));
      continue;
    }

    if (
      /\b(ENOSPC|EROFS|ECONN|ETIMEDOUT|EUSAGE|ERESOLVE|EINTEGRITY|ENOENT)\b/i.test(trimmed) ||
      /no space left on device/i.test(trimmed) ||
      /lock file/i.test(trimmed) ||
      /package-lock/i.test(trimmed)
    ) {
      actionable.push(trimmed.replace(/^\d+\s+\w+\s+/, ""));
    }
  }
  return [...new Set(actionable.map((line) => line.trim()).filter(Boolean))];
}

/** Extract actionable npm failure text — not debug log path lines or binary buffer dumps. */
export function formatInstallFailureReason(stderr: string, stdout: string): string {
  const streamLines = `${stderr}\n${stdout}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !isNpmLogNoiseLine(line));

  const streamErrors = streamLines.filter(
    (line) =>
      line.startsWith("npm error") ||
      /\b(ERESOLVE|EUSAGE|ENOTFOUND|ETIMEDOUT|ENOSPC|EROFS|EINTEGRITY)\b/i.test(line) ||
      /lock file/i.test(line) ||
      /package-lock/i.test(line) ||
      /no space left on device/i.test(line)
  );

  if (streamErrors.length > 0) {
    return [...new Set(streamErrors.map((line) => line.replace(/^npm error\s*/i, "")))]
      .slice(0, 4)
      .join(" ");
  }

  const logErrors = parseNpmDebugLog(`${stderr}\n${stdout}`);
  if (logErrors.length > 0) {
    return logErrors.slice(0, 4).join(" ");
  }

  /**
   * Last resort. Only lines that still look diagnostic survive to here —
   * numbered debug lines and (as of the production incident above) npm warn
   * chatter are already gone. If nothing diagnostic remains, say so plainly
   * rather than echoing whatever text happened to be printed last: a reason
   * assembled from benign output reads as a root cause and sends the reader
   * to the wrong place.
   */
  const fallback = streamLines.filter((line) => !/^\d+\s/.test(line)).slice(-3);
  if (fallback.length > 0) {
    return fallback.join(" ");
  }

  return "Dependency install failed before repository checks could run.";
}

/**
 * Describes HOW a process died when the output says nothing useful.
 *
 * A dependency install killed by the 2 GB Fly machine's OOM killer, or cut off
 * by the install timeout, typically produces no `npm error` line at all — the
 * process never got to write one. Without this the failure reason falls
 * through to generic text and the operator cannot tell an OOM from a network
 * stall from a genuine dependency conflict.
 */
export function describeProcessTermination(result: {
  exitCode?: number | null;
  signal?: string | null;
  timedOut?: boolean;
}): string | null {
  if (result.timedOut) {
    return "Dependency install exceeded its time limit and was terminated (no npm error was emitted).";
  }
  if (result.signal === "SIGKILL" || result.exitCode === 137) {
    return "Dependency install was killed (SIGKILL/exit 137) — this is characteristic of the container running out of memory.";
  }
  if (result.signal === "SIGTERM" || result.exitCode === 143) {
    return "Dependency install was terminated (SIGTERM/exit 143) before it completed.";
  }
  if (result.signal) {
    return `Dependency install terminated by signal ${result.signal}.`;
  }
  return null;
}

/** User-facing install failure — never expose npm silly/http debug lines. */
export function humanizeInstallFailure(reason: string): string {
  const clean = sanitizeInstallOutput(reason).replace(/\s+/g, " ").trim();
  if (/\bENOSPC\b|no space left on device/i.test(clean)) {
    return "Dependency install failed: server temporary storage is full (ENOSPC). RepoDiet freed workspace scratch data and uses a minimal verification install on serverless — click Regenerate Quick Cleanup after deploy.";
  }
  if (/\bERESOLVE\b/i.test(clean)) {
    return "Dependency install failed: npm could not resolve the dependency tree (ERESOLVE). If the repository requires legacy-peer-deps, commit that setting in .npmrc.";
  }
  if (!clean || /^install failed$/i.test(clean)) {
    return "Dependency install failed before repository checks could run.";
  }
  return clean.length > 400 ? `${clean.slice(0, 400)}…` : clean;
}

async function readLatestNpmLog(cacheDir: string): Promise<string | null> {
  try {
    const logsDir = path.join(cacheDir, "_logs");
    const files = (await fs.readdir(logsDir)).filter((f) => f.endsWith(".log")).sort();
    const latest = files.at(-1);
    if (!latest) return null;
    const raw = await fs.readFile(path.join(logsDir, latest), "utf8");
    const parsed = parseNpmDebugLog(raw);
    return parsed.length > 0 ? parsed.slice(0, 4).join(" ") : null;
  } catch {
    return null;
  }
}

function isPeerDependencyError(stderr: string, stdout: string): boolean {
  const text = `${stderr}\n${stdout}`.toLowerCase();
  return text.includes("eresolve") || text.includes("unable to resolve dependency tree");
}

function isLockfileSyncError(stderr: string, stdout: string): boolean {
  const text = `${stderr}\n${stdout}`.toLowerCase();
  return (
    text.includes("eusage") ||
    text.includes("ereseolve") ||
    text.includes("invalid lock file") ||
    text.includes("out of sync") ||
    text.includes("out of date") ||
    (text.includes("package-lock") &&
      (text.includes("does not match") || text.includes("npm ci") || text.includes("sync")))
  );
}

export function lockfileWasPatched(paths: string[]): boolean {
  return paths.some((p) =>
    /(^|\/)package\.json$|(^|\/)package-lock\.json$|(^|\/)pnpm-lock\.yaml$|(^|\/)yarn\.lock$|(^|\/)bun\.lockb$/.test(
      p.replace(/\\/g, "/")
    )
  );
}

function isIntegrityError(stderr: string, stdout: string): boolean {
  const text = `${stderr}\n${stdout}`.toLowerCase();
  return (
    text.includes("eintegrity") ||
    text.includes("tarball") ||
    text.includes("checksum") ||
    text.includes("corrupt")
  );
}

function isDiskSpaceError(stderr: string, stdout: string): boolean {
  const text = `${stderr}\n${stdout}`.toLowerCase();
  return text.includes("enospc") || text.includes("no space left on device") || text.includes("erofs");
}

function installEnv(cacheDir: string | undefined, rootDir: string, mode: "workspace" | "verify" = "workspace"): NodeJS.ProcessEnv {
  if (mode === "verify") {
    return verificationInstallEnv(cacheDir);
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CI: "true",
    FORCE_COLOR: "0",
    NODE_ENV: "development",
    NPM_CONFIG_AUDIT: "false",
    NPM_CONFIG_FUND: "false",
    NPM_CONFIG_FETCH_RETRIES: "5",
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT: "20000",
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT: "120000",
    NPM_CONFIG_PROGRESS: "false",
    NPM_CONFIG_LOGLEVEL: "warn",
    NPM_CONFIG_OPTIONAL: "false",
    // Incident #23 — see NPM_MAX_SOCKETS. Set as env as well as a flag so the
    // cap holds for any npm invocation that inherits this environment.
    NPM_CONFIG_MAXSOCKETS: NPM_MAX_SOCKETS,
  };

  if (cacheDir) {
    env.NPM_CONFIG_CACHE = isServerlessRuntime()
      ? path.join(rootDir, ".repodiet-npm-cache")
      : cacheDir;
  }

  return env;
}

/**
 * Caps how many sockets npm opens at once.
 *
 * === Incident #23: `nice` cannot fix an I/O fight ===
 *
 * Deprioritising the install's CPU (Incident #22) was confirmed working live at
 * nice 19 and still did not restore the heartbeat: every `gate-check` timed out
 * at 150s while an install ran. `gate-check` shells out to `okx-a2a doctor`,
 * whose cost is dominated by live network calls (npm registry, OKX backend,
 * XMTP). npm's default of 15 concurrent sockets saturates exactly that network
 * on a shared-cpu-1x box, so the two compete for a resource `nice` does not
 * schedule.
 *
 * Three sockets still pipeline the download comfortably — installs get slower,
 * not stalled — while leaving the runtime enough headroom to prove itself
 * online. Trading install wall-clock for agent availability is the right
 * direction: nobody is waiting on the install interactively, and an agent that
 * cannot answer is worth less than a cleanup that takes a minute longer.
 */
const NPM_MAX_SOCKETS = "3";

function workspaceNpmFlags(cacheDir?: string): string[] {
  const cacheFlag = cacheDir ? ["--cache", cacheDir] : [];
  return [
    "--ignore-scripts",
    "--omit=optional",
    "--no-audit",
    "--no-fund",
    "--maxsockets",
    NPM_MAX_SOCKETS,
    ...cacheFlag,
    "--legacy-peer-deps",
  ];
}

function installVariants(pm: PackageManager, lockfilePresent: boolean, cacheDir?: string): string[][] {
  switch (pm) {
    case "pnpm":
      return [
        ["pnpm", "install", "--ignore-scripts", "--no-frozen-lockfile"],
        ["pnpm", "install", "--ignore-scripts", "--no-frozen-lockfile", "--force"],
      ];
    case "yarn":
      return [
        ["yarn", "install", "--ignore-scripts"],
        ["yarn", "install", "--ignore-scripts", "--force"],
      ];
    case "bun":
      return [["bun", "install", "--ignore-scripts"]];
    default:
      return npmInstallVariants(lockfilePresent, cacheDir);
  }
}

function npmInstallVariants(lockfilePresent: boolean, cacheDir?: string): string[][] {
  const flags = workspaceNpmFlags(cacheDir);
  if (lockfilePresent) {
    return [["npm", "ci", ...flags]];
  }
  return [["npm", "install", ...flags]];
}

export async function nodeModulesPresent(rootDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(rootDir, "node_modules"));
    return true;
  } catch {
    return false;
  }
}

export async function isWorkspaceDependencyReady(rootDir: string): Promise<boolean> {
  if (!(await nodeModulesPresent(rootDir))) return false;
  try {
    const entries = await fs.readdir(path.join(rootDir, "node_modules"));
    const packages = entries.filter((entry) => !entry.startsWith("."));
    return packages.length >= 5;
  } catch {
    return false;
  }
}

async function lockfilePresent(rootDir: string): Promise<boolean> {
  for (const name of ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb"]) {
    try {
      await fs.access(path.join(rootDir, name));
      return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

async function hasNpmLockfile(rootDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(rootDir, "package-lock.json"));
    return true;
  } catch {
    return false;
  }
}

export function inferRequiredPackagesForScripts(
  scripts: Record<string, string>
): string[] {
  const required = new Set<string>();
  for (const [name, command] of Object.entries(scripts)) {
    const cmd = command.toLowerCase();
    if (name === "typecheck" && cmd.includes("tsc")) required.add("typescript");
    if (name === "build" && cmd.includes("next")) required.add("next");
    if (name === "lint" && cmd.includes("eslint")) required.add("eslint");
    if (name === "test" && (cmd.includes("vitest") || cmd.includes("jest"))) {
      if (cmd.includes("vitest")) required.add("vitest");
      if (cmd.includes("jest")) required.add("jest");
    }
  }
  return [...required];
}

/** Read a package version from package.json, then package-lock.json. */
export async function resolvePackageVersionSpec(
  rootDir: string,
  packageName: string
): Promise<string> {
  const pkgPath = path.join(rootDir, "package.json");
  const pkg = JSON.parse(await fs.readFile(pkgPath, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const fromPkg = pkg.dependencies?.[packageName] ?? pkg.devDependencies?.[packageName];
  if (fromPkg) return `${packageName}@${fromPkg}`;

  try {
    const lockPath = path.join(rootDir, "package-lock.json");
    const lock = JSON.parse(await fs.readFile(lockPath, "utf8")) as {
      packages?: Record<string, { version?: string; dependencies?: Record<string, string> }>;
      dependencies?: Record<string, { version?: string }>;
    };
    const rootDep = lock.packages?.[""]?.dependencies?.[packageName];
    if (rootDep) return `${packageName}@${rootDep}`;

    const nodeEntry = lock.packages?.[`node_modules/${packageName}`];
    if (nodeEntry?.version) return `${packageName}@${nodeEntry.version}`;

    const legacy = lock.dependencies?.[packageName]?.version;
    if (legacy) return `${packageName}@${legacy}`;
  } catch {
    /* no lockfile */
  }

  if (packageName === "react-dom" && pkg.dependencies?.react) {
    return `react-dom@${pkg.dependencies.react}`;
  }

  return packageName;
}

/** Package@version specs for a minimal serverless verification install. */
export async function packageSpecsForVerification(
  rootDir: string,
  requiredPackages: string[]
): Promise<string[]> {
  const raw = await fs.readFile(path.join(rootDir, "package.json"), "utf8");
  const pkg = JSON.parse(raw) as {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const names = new Set(requiredPackages);
  const scripts = pkg.scripts ?? {};
  if (scripts.build?.toLowerCase().includes("next")) {
    names.add("react");
    names.add("react-dom");
  }
  const specs: string[] = [];
  for (const name of names) {
    specs.push(await resolvePackageVersionSpec(rootDir, name));
  }
  return specs;
}

export async function isPackageInstalled(
  rootDir: string,
  packageName: string
): Promise<boolean> {
  try {
    await fs.access(path.join(rootDir, "node_modules", packageName, "package.json"));
    return true;
  } catch {
    return false;
  }
}

export async function areRequiredPackagesInstalled(
  rootDir: string,
  packageNames: string[]
): Promise<boolean> {
  if (packageNames.length === 0) return await isWorkspaceDependencyReady(rootDir);
  for (const pkg of packageNames) {
    if (!(await isPackageInstalled(rootDir, pkg))) return false;
  }
  return true;
}

function resolveVerificationCacheDir(cleanupRunId: string, rootDir: string, role: "baseline" | "patched" = "patched"): string {
  if (isServerlessRuntime()) {
    return path.join(rootDir, role === "baseline" ? ".repodiet-npm-cache-baseline" : ".repodiet-npm-cache");
  }
  const safe = cleanupRunId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(os.tmpdir(), "repodiet", safe, role === "baseline" ? "npm-cache-baseline" : "npm-cache-transformed");
}

async function clearInstallArtifacts(rootDir: string): Promise<void> {
  await prepareCleanInstallWorkspace(rootDir);
}

/**
 * Next.js build requires react/react-dom in package.json dependencies even when
 * install populated node_modules. Restore framework entries removed by false-positive findings.
 */
export async function ensureVerificationManifestIntegrity(rootDir: string): Promise<boolean> {
  const pkgPath = path.join(rootDir, "package.json");
  let pkg: {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  try {
    pkg = JSON.parse(await fs.readFile(pkgPath, "utf8")) as typeof pkg;
  } catch {
    return false;
  }

  const scripts = pkg.scripts ?? {};
  const usesNext = scripts.build?.toLowerCase().includes("next");
  if (!usesNext) return false;

  const deps = { ...(pkg.dependencies ?? {}) };
  let changed = false;
  for (const name of ["next", "react", "react-dom"]) {
    if (deps[name]) continue;
    const spec = await resolvePackageVersionSpec(rootDir, name);
    const version = spec.includes("@") ? spec.slice(spec.indexOf("@") + 1) : "";
    if (!version) continue;
    deps[name] = version;
    changed = true;
  }

  if (!changed) return false;
  pkg.dependencies = deps;
  await fs.writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  return true;
}

function perRunCacheDir(cleanupRunId: string): string {
  const safe = cleanupRunId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(os.tmpdir(), "repodiet-npm-cache", safe);
}

async function recreateCacheDir(cacheDir: string): Promise<void> {
  await prepareNpmCacheDir(cacheDir);
}

function resolveNpmCacheDir(cleanupRunId: string, rootDir: string): string {
  if (isServerlessRuntime()) {
    return path.join(rootDir, ".repodiet-npm-cache");
  }
  return perRunCacheDir(cleanupRunId);
}

async function prepareNpmCache(cacheDir: string, _serverless: boolean): Promise<void> {
  await prepareNpmCacheDir(cacheDir);
}

export async function ensureWorkspaceDependencies(
  rootDir: string
): Promise<WorkspaceInstallResult> {
  const result = await ensureWorkspaceDependenciesWithCache(rootDir, "default");
  return result;
}

export async function ensureWorkspaceDependenciesWithCache(
  rootDir: string,
  cleanupRunId: string
): Promise<WorkspaceInstallResult & { attempts: InstallAttemptRecord[] }> {
  const attempts: InstallAttemptRecord[] = [];

  try {
    await fs.access(path.join(rootDir, "package.json"));
  } catch {
    return {
      installed: false,
      reason: "No package.json in workspace.",
      attempts,
    };
  }

  if (await isWorkspaceDependencyReady(rootDir)) {
    return { installed: true, attempts };
  }

  const pm = (await detectPackageManager(rootDir)).packageManager;
  const hasLockfile = await lockfilePresent(rootDir);
  const serverless = isServerlessRuntime();
  const cacheDir = resolveNpmCacheDir(cleanupRunId, rootDir);
  await prepareNpmCache(cacheDir, serverless);

  const variants = installVariants(pm, hasLockfile, serverless ? undefined : cacheDir);
  let lastReason = "install failed";
  let lastCommand = variants[0]?.join(" ") ?? "npm install";
  let lastExitCode: number | null = null;
  let lastStdout = "";
  let lastStderr = "";
  let lastDurationMs = 0;
  let integrityRetries = 0;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const command = variants[attempt % variants.length];
    lastCommand = command.join(" ");
    const t0 = Date.now();
    const result = await runBoundedInstall(command, {
      cwd: rootDir,
      env: installEnv(cacheDir, rootDir, "workspace"),
    });
    const durationMs = Date.now() - t0;
    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";

    attempts.push({
      command: lastCommand,
      attempt: attempt + 1,
      exitCode: result.exitCode ?? null,
      stdout: summarize(stdout, 2000),
      stderr: summarize(
        formatInstallFailureReason(stderr, stdout) || stderr,
        2000
      ),
      durationMs,
    });

    if (result.exitCode === 0 || (await isWorkspaceDependencyReady(rootDir))) {
      return {
        installed: true,
        partial: result.exitCode !== 0,
        reason: result.exitCode !== 0 ? summarize(stderr || stdout || "") : undefined,
        command: lastCommand,
        exitCode: result.exitCode ?? 0,
        durationMs,
        stdout,
        stderr,
        attempts,
      };
    }

    lastReason = summarize(
      describeProcessTermination(result) ||
        formatInstallFailureReason(stderr, stdout) ||
        stderr ||
        stdout ||
        "install failed"
    );
    lastExitCode = result.exitCode ?? null;
    lastStdout = stdout;
    lastStderr = stderr;
    lastDurationMs = durationMs;

    if (
      pm === "npm" &&
      isIntegrityError(stderr, stdout) &&
      integrityRetries < CACHE_RETRY_MAX
    ) {
      integrityRetries += 1;
      await recreateCacheDir(cacheDir);
      await clearInstallArtifacts(rootDir);
      continue;
    }

    await clearInstallArtifacts(rootDir);
  }

  if (await isWorkspaceDependencyReady(rootDir)) {
    return {
      installed: true,
      partial: true,
      reason: lastReason,
      command: lastCommand,
      exitCode: lastExitCode,
      durationMs: lastDurationMs,
      stdout: lastStdout,
      stderr: lastStderr,
      attempts,
    };
  }

  return {
    installed: false,
    reason: lastReason,
    command: lastCommand,
    exitCode: lastExitCode,
    durationMs: lastDurationMs,
    stdout: lastStdout,
    stderr: lastStderr,
    attempts,
  };
}

/**
 * Strict dependency install for repository verification — clean workspace, full optional deps,
 * lifecycle scripts enabled, npm ci when lockfile is intact.
 */
export async function ensureVerificationDependencies(
  rootDir: string,
  cleanupRunId: string,
  options?: {
    requiredPackages?: string[];
    lockfilePatched?: boolean;
    patchedPaths?: string[];
    cacheRole?: "baseline" | "patched";
  }
): Promise<WorkspaceInstallResult & { attempts: InstallAttemptRecord[] }> {
  const attempts: InstallAttemptRecord[] = [];
  const requiredPackages = options?.requiredPackages ?? [];
  const lockfilePatched =
    options?.lockfilePatched ??
    (options?.patchedPaths ? lockfileWasPatched(options.patchedPaths) : false);

  try {
    await fs.access(path.join(rootDir, "package.json"));
  } catch {
    return {
      installed: false,
      reason: "No package.json in workspace.",
      attempts,
    };
  }

  await ensureVerificationManifestIntegrity(rootDir);
  await prepareCleanInstallWorkspace(rootDir);

  const pm = (await detectPackageManager(rootDir)).packageManager;
  const cacheDir = resolveVerificationCacheDir(cleanupRunId, rootDir, options?.cacheRole ?? "patched");
  await prepareNpmCacheDir(cacheDir);

  const installPlans = await buildVerificationInstallCommands(rootDir, pm, cacheDir, {
    lockfilePatched,
    preferInstall: lockfilePatched,
  });

  let lastReason = "install failed";
  let lastCommand = installPlans[0]?.command.join(" ") ?? "npm ci";
  let lastExitCode: number | null = null;
  let lastStdout = "";
  let lastStderr = "";
  let lastDurationMs = 0;
  let integrityRetries = 0;

  for (let attempt = 0; attempt < Math.min(MAX_ATTEMPTS, installPlans.length + 1); attempt += 1) {
    const plan = installPlans[attempt % installPlans.length]!;
    const command = plan.command;
    assertVerificationInstallCommand(command);
    lastCommand = command.join(" ");
    const t0 = Date.now();
    const result = await runBoundedInstall(command, { cwd: rootDir, env: plan.env });
    const durationMs = Date.now() - t0;
    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";

    attempts.push({
      command: lastCommand,
      attempt: attempt + 1,
      exitCode: result.exitCode ?? null,
      stdout: summarize(stdout, 2000),
      stderr: summarize(formatInstallFailureReason(stderr, stdout) || stderr, 2000),
      durationMs,
    });

    const packagesReady = await areRequiredPackagesInstalled(rootDir, requiredPackages);
    if (result.exitCode === 0 && packagesReady) {
      return {
        installed: true,
        command: lastCommand,
        exitCode: 0,
        durationMs,
        stdout,
        stderr,
        attempts,
      };
    }

    if (result.exitCode === 0 && !packagesReady) {
      lastReason = `Install exited 0 but required packages missing: ${requiredPackages.join(", ")}`;
      lastExitCode = 1;
      lastStdout = stdout;
      lastStderr = lastReason;
      lastDurationMs = durationMs;
      await clearInstallArtifacts(rootDir);
      continue;
    }

    const logReason = await readLatestNpmLog(cacheDir);
    /**
     * Termination cause first: an OOM kill or timeout explains the failure
     * better than whatever npm managed to flush before it died, and both
     * commonly leave no npm error line at all.
     */
    lastReason = humanizeInstallFailure(
      describeProcessTermination(result) ||
        logReason ||
        formatInstallFailureReason(stderr, stdout) ||
        summarize(stderr || stdout || "install failed")
    );
    lastExitCode = result.exitCode ?? null;
    lastStdout = stdout;
    lastStderr = stderr;
    lastDurationMs = durationMs;

    if (
      pm === "npm" &&
      plan.mode === "ci" &&
      (isLockfileSyncError(stderr, stdout) || isPeerDependencyError(stderr, stdout)) &&
      attempt + 1 < MAX_ATTEMPTS
    ) {
      continue;
    }

    if (pm === "npm" && (isIntegrityError(stderr, stdout) || isDiskSpaceError(stderr, stdout))) {
      if (integrityRetries < CACHE_RETRY_MAX) {
        integrityRetries += 1;
        await prepareNpmCacheDir(cacheDir);
        await clearInstallArtifacts(rootDir);
        continue;
      }
    }

    await clearInstallArtifacts(rootDir);
  }

  return {
    installed: false,
    reason: lastReason,
    command: lastCommand,
    exitCode: lastExitCode,
    durationMs: lastDurationMs,
    stdout: lastStdout,
    stderr: lastStderr,
    attempts,
  };
}

export { hasNpmLockfile };
