import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execa } from "execa";
import { detectPackageManager } from "@/lib/scanner/detect-package-manager";
import type { PackageManager } from "@/lib/scanner/types";
import { isServerlessRuntime } from "@/lib/server/runtime-env";

const INSTALL_TIMEOUT_MS = 180_000;
const MAX_ATTEMPTS = 4;
const CACHE_RETRY_MAX = 2;

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
    return streamErrors
      .map((line) => line.replace(/^npm error\s*/i, ""))
      .slice(0, 4)
      .join(" ");
  }

  const logErrors = parseNpmDebugLog(`${stderr}\n${stdout}`);
  if (logErrors.length > 0) {
    return logErrors.slice(0, 4).join(" ");
  }

  const fallback = streamLines.filter((line) => !/^\d+\s/.test(line)).slice(-3);
  if (fallback.length > 0) {
    return fallback.join(" ");
  }

  return "Dependency install failed before repository checks could run.";
}

/** User-facing install failure — never expose npm silly/http debug lines. */
export function humanizeInstallFailure(reason: string): string {
  const clean = sanitizeInstallOutput(reason).replace(/\s+/g, " ").trim();
  if (/\bENOSPC\b|no space left on device/i.test(clean)) {
    return "Dependency install failed: server temporary storage is full (ENOSPC). RepoDiet freed workspace scratch data and uses a minimal verification install on serverless — click Regenerate Quick Cleanup after deploy.";
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

function installEnv(cacheDir: string | undefined, rootDir: string): NodeJS.ProcessEnv {
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
  };

  if (cacheDir) {
    env.NPM_CONFIG_CACHE = isServerlessRuntime()
      ? path.join(rootDir, ".repodiet-npm-cache")
      : cacheDir;
  }

  return env;
}

function npmInstallBaseFlags(cacheDir?: string): string[] {
  const cacheFlag = cacheDir ? ["--cache", cacheDir] : [];
  return [
    "--ignore-scripts",
    "--omit=optional",
    "--no-audit",
    "--no-fund",
    ...cacheFlag,
  ];
}

function npmInstallVariants(lockfilePresent: boolean, cacheDir?: string): string[][] {
  const flags = npmInstallBaseFlags(cacheDir);
  if (lockfilePresent) {
    return [["npm", "ci", ...flags]];
  }
  return [["npm", "install", ...flags]];
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
  return [...names].map((name) => {
    const ver = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
    return ver ? `${name}@${ver}` : name;
  });
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

function npmVerificationVariants(
  lockfilePresent: boolean,
  cacheDir?: string,
  options?: { preferInstall?: boolean }
): string[][] {
  const flags = npmInstallBaseFlags(cacheDir);
  if (options?.preferInstall || !lockfilePresent) {
    return [
      ["npm", "install", ...flags],
      ["npm", "install", "--no-audit", "--no-fund", "--ignore-scripts", "--omit=optional", ...(cacheDir ? ["--cache", cacheDir] : [])],
    ];
  }
  return [
    ["npm", "ci", ...flags],
    ["npm", "install", ...flags],
    ["npm", "install", "--no-audit", "--no-fund", "--ignore-scripts", "--omit=optional", ...(cacheDir ? ["--cache", cacheDir] : [])],
  ];
}

function verificationInstallVariants(
  pm: PackageManager,
  lockfilePresent: boolean,
  cacheDir?: string,
  options?: { lockfilePatched?: boolean }
): string[][] {
  switch (pm) {
    case "pnpm":
      return [
        ["pnpm", "install", "--no-frozen-lockfile"],
        ["pnpm", "install", "--no-frozen-lockfile", "--force"],
      ];
    case "yarn":
      return [["yarn", "install"], ["yarn", "install", "--force"]];
    case "bun":
      return [["bun", "install"]];
    default:
      return npmVerificationVariants(lockfilePresent, cacheDir, {
        preferInstall: options?.lockfilePatched,
      });
  }
}

async function clearInstallArtifacts(rootDir: string): Promise<void> {
  await fs.rm(path.join(rootDir, "node_modules"), { recursive: true, force: true }).catch(() => {});
}

function resolveNpmCacheDir(cleanupRunId: string, rootDir: string): string {
  if (isServerlessRuntime()) {
    return path.join(rootDir, ".repodiet-npm-cache");
  }
  return perRunCacheDir(cleanupRunId);
}

async function prepareNpmCache(cacheDir: string, serverless: boolean): Promise<void> {
  if (serverless) {
    await fs.rm(cacheDir, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(cacheDir, { recursive: true });
    return;
  }
  await recreateCacheDir(cacheDir);
}

async function buildServerlessVerificationVariants(
  rootDir: string,
  requiredPackages: string[],
  cacheDir: string
): Promise<string[][]> {
  const specs = await packageSpecsForVerification(rootDir, requiredPackages);
  const flags = ["--no-save", ...npmInstallBaseFlags(cacheDir)];
  return [["npm", "install", ...flags, ...specs]];
}

function perRunCacheDir(cleanupRunId: string): string {
  const safe = cleanupRunId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(os.tmpdir(), "repodiet-npm-cache", safe);
}

async function recreateCacheDir(cacheDir: string): Promise<void> {
  await fs.rm(cacheDir, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(cacheDir, { recursive: true });
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
    const result = await execa(command[0], command.slice(1), {
      cwd: rootDir,
      timeout: INSTALL_TIMEOUT_MS,
      reject: false,
      env: installEnv(cacheDir, rootDir),
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

    lastReason = summarize(stderr || stdout || "install failed");
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
 * Strict dependency install for repository verification — never treats partial
 * node_modules as success and runs npm ci without --ignore-scripts.
 */
export async function ensureVerificationDependencies(
  rootDir: string,
  cleanupRunId: string,
  options?: {
    requiredPackages?: string[];
    lockfilePatched?: boolean;
    patchedPaths?: string[];
    preserveExistingModules?: boolean;
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

  if (
    options?.preserveExistingModules &&
    (await areRequiredPackagesInstalled(rootDir, requiredPackages))
  ) {
    return {
      installed: true,
      command: "reuse existing node_modules",
      exitCode: 0,
      durationMs: 0,
      stdout: "Reused node_modules from cleanup workspace.",
      stderr: "",
      attempts,
    };
  }

  const serverless = isServerlessRuntime();
  if (!serverless && !options?.preserveExistingModules) {
    await clearInstallArtifacts(rootDir);
  }

  const pm = (await detectPackageManager(rootDir)).packageManager;
  const hasLockfile = await lockfilePresent(rootDir);
  const cacheDir = resolveNpmCacheDir(cleanupRunId, rootDir);
  await prepareNpmCache(cacheDir, serverless);

  const variants = serverless
    ? await buildServerlessVerificationVariants(rootDir, requiredPackages, cacheDir)
    : verificationInstallVariants(pm, hasLockfile, cacheDir, { lockfilePatched });
  const maxAttempts = serverless ? 2 : MAX_ATTEMPTS;
  let lastReason = "install failed";
  let lastCommand = variants[0]?.join(" ") ?? "npm ci";
  let lastExitCode: number | null = null;
  let lastStdout = "";
  let lastStderr = "";
  let lastDurationMs = 0;
  let integrityRetries = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const command = variants[attempt % variants.length];
    lastCommand = command.join(" ");
    const t0 = Date.now();
    const result = await execa(command[0], command.slice(1), {
      cwd: rootDir,
      timeout: INSTALL_TIMEOUT_MS,
      reject: false,
      env: installEnv(cacheDir, rootDir),
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
    lastReason = humanizeInstallFailure(
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
      command[1] === "ci" &&
      isLockfileSyncError(stderr, stdout) &&
      attempt + 1 < MAX_ATTEMPTS
    ) {
      continue;
    }

    if (
      pm === "npm" &&
      (isIntegrityError(stderr, stdout) || isDiskSpaceError(stderr, stdout)) &&
      integrityRetries < CACHE_RETRY_MAX &&
      !serverless
    ) {
      integrityRetries += 1;
      await recreateCacheDir(cacheDir);
      await fs
        .rm(path.join(rootDir, ".repodiet-npm-cache"), { recursive: true, force: true })
        .catch(() => {});
      if (!options?.preserveExistingModules) {
        await clearInstallArtifacts(rootDir);
      }
      continue;
    }

    if (!serverless && !options?.preserveExistingModules) {
      await clearInstallArtifacts(rootDir);
    }
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
