import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { execa } from "execa";
import type { ClassifiedItem } from "./types";
import { EMPTY_CLEANUP_PATCH } from "./generate-cleanup-patch";

const MAX_FILE_BYTES = 512 * 1024;

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function initGitBaseline(rootDir: string): Promise<void> {
  await execa("git", ["init"], { cwd: rootDir, reject: false });
  await execa("git", ["add", "-A"], { cwd: rootDir, reject: false });
  await execa(
    "git",
    [
      "-c",
      "user.email=repodiet@local",
      "-c",
      "user.name=RepoDiet",
      "commit",
      "-m",
      "repodiet-baseline",
      "--allow-empty",
    ],
    { cwd: rootDir, reject: false }
  );
}

/**
 * Generate a valid unified diff by deleting files in a git baseline workspace.
 * This produces patches that pass `git apply --check`.
 */
export async function generateUnifiedDeletePatch(
  rootDir: string,
  safeItems: ClassifiedItem[]
): Promise<{ patch: string; deletedPaths: string[] }> {
  if (safeItems.length === 0) {
    return { patch: EMPTY_CLEANUP_PATCH, deletedPaths: [] };
  }

  await initGitBaseline(rootDir);

  const deletedPaths: string[] = [];

  for (const item of safeItems) {
    const rel = item.path.replace(/\\/g, "/").replace(/^\.\//, "");
    const fullPath = path.join(rootDir, rel);

    if (!(await fileExists(fullPath))) continue;

    const stat = await fs.stat(fullPath);
    if (!stat.isFile()) continue;
    if (stat.size > MAX_FILE_BYTES) continue;

    await fs.rm(fullPath, { force: true });
    deletedPaths.push(rel);
  }

  if (deletedPaths.length === 0) {
    return { patch: EMPTY_CLEANUP_PATCH, deletedPaths: [] };
  }

  const diff = await execa("git", ["diff", "--no-color", "HEAD", "--", ...deletedPaths], {
    cwd: rootDir,
    reject: false,
  });

  const patch = diff.stdout?.trim();
  if (!patch) {
    return { patch: EMPTY_CLEANUP_PATCH, deletedPaths: [] };
  }

  const header = [
    "# RepoDiet cleanup patch",
    "# Valid unified diff — apply with: git apply repodiet-cleanup.patch",
    `# Safe deletions: ${deletedPaths.length}`,
    "",
  ].join("\n");

  return {
    patch: `${header}\n${patch}\n`,
    deletedPaths,
  };
}

/** Preview delete patch on a copied workspace — does not modify the source root. */
export async function previewUnifiedDeletePatch(
  sourceRoot: string,
  safeItems: ClassifiedItem[],
  scratchDir: string
): Promise<{ patch: string; deletedPaths: string[] }> {
  if (safeItems.length === 0) {
    return { patch: EMPTY_CLEANUP_PATCH, deletedPaths: [] };
  }
  const copyRoot = path.join(scratchDir, `delete-preview-${nanoid(8)}`);
  await fs.cp(sourceRoot, copyRoot, { recursive: true });
  try {
    return await generateUnifiedDeletePatch(copyRoot, safeItems);
  } finally {
    await fs.rm(copyRoot, { recursive: true, force: true }).catch(() => {});
  }
}

export async function copyRepoBaseline(sourceRoot: string, targetRoot: string): Promise<void> {
  await fs.rm(targetRoot, { recursive: true, force: true }).catch(() => {});
  await fs.cp(sourceRoot, targetRoot, { recursive: true });
}
