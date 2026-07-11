import fs from "node:fs/promises";
import path from "node:path";
import type { PackageManager } from "@/lib/scanner/types";

export interface NpmRcPolicy {
  legacyPeerDeps: boolean;
  source: "committed-npmrc" | "none";
}

export interface PackageInstallCommand {
  command: string[];
  env: NodeJS.ProcessEnv;
  mode: "ci" | "install";
}

const NPM_COMMON_FLAGS = ["--include=dev", "--include=optional", "--no-audit", "--no-fund"] as const;

/** Read committed .npmrc for install policy — never auto-enable legacy-peer-deps. */
export async function readNpmRcPolicy(rootDir: string): Promise<NpmRcPolicy> {
  try {
    const raw = await fs.readFile(path.join(rootDir, ".npmrc"), "utf8");
    const legacyPeerDeps = /^\s*legacy-peer-deps\s*=\s*true\s*$/im.test(raw);
    return { legacyPeerDeps, source: "committed-npmrc" };
  } catch {
    return { legacyPeerDeps: false, source: "none" };
  }
}

export async function hasLockfile(rootDir: string, pm: PackageManager): Promise<boolean> {
  const names =
    pm === "pnpm"
      ? ["pnpm-lock.yaml"]
      : pm === "yarn"
        ? ["yarn.lock"]
        : pm === "bun"
          ? ["bun.lockb"]
          : ["package-lock.json"];
  for (const name of names) {
    try {
      await fs.access(path.join(rootDir, name));
      return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

export function verificationInstallEnv(
  cacheDir: string | undefined,
  options?: { forBuild?: boolean }
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CI: "true",
    FORCE_COLOR: "0",
    NODE_ENV: options?.forBuild ? "production" : "development",
    NPM_CONFIG_AUDIT: "false",
    NPM_CONFIG_FUND: "false",
    NPM_CONFIG_OMIT: "",
    NPM_CONFIG_OPTIONAL: "true",
    NPM_CONFIG_IGNORE_SCRIPTS: "false",
    NPM_CONFIG_PROGRESS: "false",
    NPM_CONFIG_LOGLEVEL: "warn",
    NPM_CONFIG_FETCH_RETRIES: "5",
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT: "20000",
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT: "120000",
    ...(cacheDir ? { NPM_CONFIG_CACHE: cacheDir } : {}),
  };
}

/** Production verification install — never omits optional deps or ignores lifecycle scripts. */
export async function buildVerificationInstallCommands(
  rootDir: string,
  pm: PackageManager,
  cacheDir: string | undefined,
  options?: { lockfilePatched?: boolean; preferInstall?: boolean }
): Promise<PackageInstallCommand[]> {
  const npmrc = await readNpmRcPolicy(rootDir);
  const lockfilePresent = await hasLockfile(rootDir, pm);
  const cacheFlag = cacheDir ? ["--cache", cacheDir] : [];
  const env = verificationInstallEnv(cacheDir);

  switch (pm) {
    case "pnpm":
      return [
        {
          command: ["pnpm", "install", "--no-frozen-lockfile", ...cacheFlag],
          env,
          mode: "install",
        },
      ];
    case "yarn":
      return [{ command: ["yarn", "install", ...cacheFlag], env, mode: "install" }];
    case "bun":
      return [{ command: ["bun", "install", ...cacheFlag], env, mode: "install" }];
    default: {
      const legacyFlag = npmrc.legacyPeerDeps ? ["--legacy-peer-deps"] : [];
      const npmFlags = [...NPM_COMMON_FLAGS, ...cacheFlag, ...legacyFlag];
      const useCi =
        lockfilePresent && !options?.lockfilePatched && !options?.preferInstall;
      if (useCi) {
        return [{ command: ["npm", "ci", ...npmFlags], env, mode: "ci" }];
      }
      return [
        { command: ["npm", "install", ...npmFlags], env, mode: "install" },
        ...(lockfilePresent
          ? [{ command: ["npm", "ci", ...npmFlags], env, mode: "ci" as const }]
          : []),
      ];
    }
  }
}

/** Flags that must never appear on default verification installs. */
export const FORBIDDEN_VERIFICATION_INSTALL_FLAGS = [
  "--omit=optional",
  "--ignore-scripts",
] as const;

export function assertVerificationInstallCommand(command: string[]): void {
  for (const flag of FORBIDDEN_VERIFICATION_INSTALL_FLAGS) {
    if (command.includes(flag)) {
      throw new Error(`Forbidden verification install flag: ${flag}`);
    }
  }
}
