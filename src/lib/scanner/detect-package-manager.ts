import fs from "node:fs/promises";
import path from "node:path";
import type { PackageManager } from "./types";

const LOCKFILES: { file: string; manager: PackageManager }[] = [
  { file: "pnpm-lock.yaml", manager: "pnpm" },
  { file: "package-lock.json", manager: "npm" },
  { file: "yarn.lock", manager: "yarn" },
  { file: "bun.lockb", manager: "bun" },
];

export interface PackageManagerDetection {
  packageManager: PackageManager;
  lockfile?: string;
}

export async function detectPackageManager(
  rootDir: string
): Promise<PackageManagerDetection> {
  for (const { file, manager } of LOCKFILES) {
    try {
      await fs.access(path.join(rootDir, file));
      return { packageManager: manager, lockfile: file };
    } catch {
      /* try next */
    }
  }

  try {
    await fs.access(path.join(rootDir, "package.json"));
    return { packageManager: "npm" };
  } catch {
    return { packageManager: "npm" };
  }
}
