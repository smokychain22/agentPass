import fs from "node:fs/promises";
import path from "node:path";
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

async function clearInstallArtifacts(rootDir: string): Promise<void> {
  await fs.rm(path.join(rootDir, "node_modules"), { recursive: true, force: true }).catch(() => {});
}

function perRunCacheDir(cleanupRunId: string): string {
  const safe = cleanupRunId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join("/tmp/repodiet-npm-cache", safe);
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

export { hasNpmLockfile };
