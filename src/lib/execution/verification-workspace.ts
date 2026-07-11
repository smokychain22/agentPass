import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import os from "node:os";

export type VerificationWorkspaceRole = "baseline" | "transformed" | "validation";

export interface VerificationWorkspaceLayout {
  runRoot: string;
  baseline: string;
  transformed: string;
  validation: string;
  npmCacheBaseline: string;
  npmCacheTransformed: string;
}

export function buildVerificationWorkspaceLayout(cleanupRunId: string): VerificationWorkspaceLayout {
  const safe = cleanupRunId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const runRoot = path.join(os.tmpdir(), "repodiet", safe);
  return {
    runRoot,
    baseline: path.join(runRoot, "baseline"),
    transformed: path.join(runRoot, "transformed"),
    validation: path.join(runRoot, "validation"),
    npmCacheBaseline: path.join(runRoot, "npm-cache-baseline"),
    npmCacheTransformed: path.join(runRoot, "npm-cache-transformed"),
  };
}

export async function hashPackageJson(rootDir: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(path.join(rootDir, "package.json"), "utf8");
    return createHash("sha256").update(raw).digest("hex").slice(0, 16);
  } catch {
    return null;
  }
}

/** Remove inherited install artifacts before a clean verification install. */
export async function prepareCleanInstallWorkspace(rootDir: string): Promise<void> {
  await fs.rm(path.join(rootDir, "node_modules"), { recursive: true, force: true }).catch(() => {});
  await fs.rm(path.join(rootDir, ".next"), { recursive: true, force: true }).catch(() => {});
  await fs.rm(path.join(rootDir, ".repodiet-npm-cache"), { recursive: true, force: true }).catch(() => {});
}

export async function prepareNpmCacheDir(cacheDir: string): Promise<void> {
  await fs.rm(cacheDir, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(cacheDir, { recursive: true });
}
