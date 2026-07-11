import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { detectPackageManager } from "@/lib/scanner/detect-package-manager";
import type { PackageManager } from "@/lib/scanner/types";

const INSTALL_TIMEOUT_MS = 180_000;
const MAX_ATTEMPTS = 4;

export interface WorkspaceInstallResult {
  installed: boolean;
  partial?: boolean;
  reason?: string;
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

function installEnv(): NodeJS.ProcessEnv {
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
  };
}

function npmInstallVariants(lockfilePresent: boolean): string[][] {
  const base = [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--legacy-peer-deps",
  ];
  const variants: string[][] = [["npm", ...base]];
  if (lockfilePresent) {
    variants.push(["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund", "--legacy-peer-deps"]);
  }
  variants.push(["npm", ...base, "--force"]);
  return variants;
}

function installVariants(pm: PackageManager, lockfilePresent: boolean): string[][] {
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
      return [
        ["bun", "install", "--ignore-scripts"],
      ];
    default:
      return npmInstallVariants(lockfilePresent);
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

async function clearInstallArtifacts(rootDir: string): Promise<void> {
  await fs.rm(path.join(rootDir, "node_modules"), { recursive: true, force: true }).catch(() => {});
}

export async function ensureWorkspaceDependencies(
  rootDir: string
): Promise<WorkspaceInstallResult> {
  try {
    await fs.access(path.join(rootDir, "package.json"));
  } catch {
    return { installed: false, reason: "No package.json in workspace." };
  }

  if (await isWorkspaceDependencyReady(rootDir)) {
    return { installed: true };
  }

  const pm = (await detectPackageManager(rootDir)).packageManager;
  const hasLockfile = await lockfilePresent(rootDir);
  const variants = installVariants(pm, hasLockfile);
  let lastReason = "install failed";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const command = variants[attempt % variants.length];
    const result = await execa(command[0], command.slice(1), {
      cwd: rootDir,
      timeout: INSTALL_TIMEOUT_MS,
      reject: false,
      env: installEnv(),
    });

    if (result.exitCode === 0 || (await isWorkspaceDependencyReady(rootDir))) {
      return {
        installed: true,
        partial: result.exitCode !== 0,
        reason: result.exitCode !== 0 ? summarize(result.stderr || result.stdout || "") : undefined,
      };
    }

    lastReason = summarize(result.stderr || result.stdout || "install failed");
    await clearInstallArtifacts(rootDir);
  }

  if (await isWorkspaceDependencyReady(rootDir)) {
    return { installed: true, partial: true, reason: lastReason };
  }

  return { installed: false, reason: lastReason };
}
