import fs from "node:fs/promises";
import path from "node:path";
import { isServerlessRuntime } from "@/lib/server/runtime-env";

/**
 * Free ephemeral disk on serverless before verification install.
 * Baseline copy and scan reports are not needed after patch validation.
 */
export async function trimWorkspaceBeforeVerification(
  workDir: string,
  repoRoot: string
): Promise<void> {
  if (!isServerlessRuntime()) return;

  const targets = [
    path.join(workDir, "patch-baseline"),
    path.join(workDir, "delete-scratch"),
    path.join(workDir, "reports"),
    path.join(workDir, "repository.zip"),
    path.join(repoRoot, ".repodiet-jscpd"),
    path.join(repoRoot, ".next"),
    path.join(repoRoot, "node_modules", ".cache"),
    path.join(repoRoot, ".repodiet-npm-cache"),
  ];

  await Promise.all(
    targets.map((target) => fs.rm(target, { recursive: true, force: true }).catch(() => {}))
  );
}
