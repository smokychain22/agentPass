import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execa } from "execa";
import { detectPackageManager } from "@/lib/scanner/detect-package-manager";
import type { PackageManager } from "@/lib/scanner/types";

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
  const trimmed = text.trim();
  if (!trimmed) return "";
  const withoutWarnings = trimmed
    .split("\n")
    .filter((line) => !/^\s*npm warn\b/i.test(line))
    .join("\n")
    .trim();
  const source = withoutWarnings || trimmed;
  return source.length > max ? `${source.slice(0, max)}…` : source;
}

/** Extract actionable npm failure text — not just the debug log path line. */
export function formatInstallFailureReason(stderr: string, stdout: string): string {
  const lines = `${stderr}\n${stdout}`
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(
      (line) =>
        !line.startsWith("npm error A complete log of this run can be found in:") &&
        !line.startsWith("npm notice")
    );

  const errors = lines.filter(
    (line) =>
      line.startsWith("npm error") ||
      line.includes("ERESOLVE") ||
      line.includes("EUSAGE") ||
      line.includes("ENOTFOUND") ||
      line.includes("ETIMEDOUT") ||
      line.includes("lock file") ||
      line.includes("package-lock")
  );

  if (errors.length > 0) {
    return errors
      .map((line) => line.replace(/^npm error\s*/i, ""))
      .slice(0, 4)
      .join(" ");
  }

  return lines.slice(-4).join(" ") || "npm install failed";
}

async function readLatestNpmLog(cacheDir: string): Promise<string | null> {
  try {
    const logsDir = path.join(cacheDir, "_logs");
    const files = (await fs.readdir(logsDir)).filter((f) => f.endsWith(".log")).sort();
    const latest = files.at(-1);
    if (!latest) return null;
    const raw = await fs.readFile(path.join(logsDir, latest), "utf8");
    return formatInstallFailureReason(raw, "");
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

function installEnv(cacheDir?: string): NodeJS.ProcessEnv {
  return {
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
    ...(cacheDir ? { NPM_CONFIG_CACHE: cacheDir } : {}),
  };
}

function npmInstallVariants(lockfilePresent: boolean, cacheDir?: string): string[][] {
  const cacheFlag = cacheDir ? ["--cache", cacheDir] : [];
  if (lockfilePresent) {
    return [
      [
        "npm",
        "ci",
        "--prefer-online",
        "--no-audit",
        "--no-fund",
        "--ignore-scripts",
        ...cacheFlag,
      ],
    ];
  }
  return [
    [
      "npm",
      "install",
      "--prefer-online",
      "--no-audit",
      "--no-fund",
      "--ignore-scripts",
      ...cacheFlag,
    ],
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
  const cacheFlag = cacheDir ? ["--cache", cacheDir] : [];
  if (options?.preferInstall || !lockfilePresent) {
    return [
      ["npm", "install", "--prefer-online", "--no-audit", "--no-fund", ...cacheFlag],
      ["npm", "install", "--no-audit", "--no-fund", ...cacheFlag],
    ];
  }
  return [
    ["npm", "ci", "--prefer-online", "--no-audit", "--no-fund", ...cacheFlag],
    ["npm", "install", "--prefer-online", "--no-audit", "--no-fund", ...cacheFlag],
    ["npm", "install", "--no-audit", "--no-fund", ...cacheFlag],
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
  const cacheDir = perRunCacheDir(cleanupRunId);
  await recreateCacheDir(cacheDir);

  const variants = installVariants(pm, hasLockfile, cacheDir);
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
      env: installEnv(cacheDir),
    });
    const durationMs = Date.now() - t0;
    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";

    attempts.push({
      command: lastCommand,
      attempt: attempt + 1,
      exitCode: result.exitCode ?? null,
      stdout: summarize(stdout, 2000),
      stderr: summarize(stderr, 2000),
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
  options?: { requiredPackages?: string[]; lockfilePatched?: boolean; patchedPaths?: string[] }
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

  await clearInstallArtifacts(rootDir);

  const pm = (await detectPackageManager(rootDir)).packageManager;
  const hasLockfile = await lockfilePresent(rootDir);
  const cacheDir = perRunCacheDir(cleanupRunId);
  await recreateCacheDir(cacheDir);

  const variants = verificationInstallVariants(pm, hasLockfile, cacheDir, { lockfilePatched });
  let lastReason = "install failed";
  let lastCommand = variants[0]?.join(" ") ?? "npm ci";
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
      env: installEnv(cacheDir),
    });
    const durationMs = Date.now() - t0;
    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";

    attempts.push({
      command: lastCommand,
      attempt: attempt + 1,
      exitCode: result.exitCode ?? null,
      stdout: summarize(stdout, 2000),
      stderr: summarize(stderr, 2000),
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
    lastReason =
      logReason ||
      formatInstallFailureReason(stderr, stdout) ||
      summarize(stderr || stdout || "install failed");
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
