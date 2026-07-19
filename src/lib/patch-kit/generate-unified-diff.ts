import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { execa } from "execa";
import type { ClassifiedItem } from "./types";
import { EMPTY_CLEANUP_PATCH } from "./generate-cleanup-patch";
import { ensureGitRepoInitialized, isGitCliAvailable } from "./git-runtime";

const MAX_FILE_BYTES = 512 * 1024;

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pure-JS delete diff for zip/serverless workspaces where `git` baseline is unreliable.
 * Matches the dry-run delete path used by eligibility preflight.
 */
export function buildPureJsDeletePatch(relPath: string, content: string): string {
  const normalized = content.replace(/\r\n/g, "\n");
  const fileLines =
    normalized === ""
      ? []
      : normalized.endsWith("\n")
        ? normalized.slice(0, -1).split("\n")
        : normalized.split("\n");
  const lines = [
    `diff --git a/${relPath} b/${relPath}`,
    `deleted file mode 100644`,
    `--- a/${relPath}`,
    `+++ /dev/null`,
  ];
  if (fileLines.length === 0) {
    lines.push(`@@ -0,0 +0,0 @@`);
  } else {
    lines.push(`@@ -1,${fileLines.length} +0,0 @@`);
    for (const line of fileLines) {
      lines.push(`-${line}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function buildPureJsDeleteBundle(
  entries: Array<{ rel: string; content: string }>
): { patch: string; deletedPaths: string[] } {
  const deletedPaths = entries.map((entry) => entry.rel);
  const body = entries.map((entry) => buildPureJsDeletePatch(entry.rel, entry.content)).join("\n");
  const header = [
    "# RepoDiet cleanup patch",
    "# Valid unified diff — apply with: git apply repodiet-cleanup.patch",
    `# Safe deletions: ${deletedPaths.length}`,
    "# Generator: pure-js (zip/serverless safe)",
    "",
  ].join("\n");
  return { patch: `${header}\n${body}`, deletedPaths };
}

/**
 * Generate a valid unified delete diff.
 * Prefer pure-JS for GitHub zip workspaces (no .git) and serverless runtimes where
 * `git init/add/commit/diff` is missing or fails silently — that previously yielded
 * empty delete patches and blocked all cleanup PR canaries on Vercel.
 */
export async function generateUnifiedDeletePatch(
  rootDir: string,
  safeItems: ClassifiedItem[]
): Promise<{ patch: string; deletedPaths: string[] }> {
  if (safeItems.length === 0) {
    return { patch: EMPTY_CLEANUP_PATCH, deletedPaths: [] };
  }

  const entries: Array<{ rel: string; content: string }> = [];
  for (const item of safeItems) {
    const rel = item.path.replace(/\\/g, "/").replace(/^\.\//, "");
    const fullPath = path.join(rootDir, rel);

    if (!(await fileExists(fullPath))) continue;

    const stat = await fs.stat(fullPath);
    if (!stat.isFile()) continue;
    if (stat.size > MAX_FILE_BYTES) continue;

    const content = await fs.readFile(fullPath, "utf8");
    entries.push({ rel, content });
  }

  if (entries.length === 0) {
    return { patch: EMPTY_CLEANUP_PATCH, deletedPaths: [] };
  }

  const gitAvailable = await isGitCliAvailable();
  if (gitAvailable) {
    const initialized = await ensureGitRepoInitialized(rootDir);
    if (initialized) {
      const deletedPaths: string[] = [];
      for (const entry of entries) {
        await fs.rm(path.join(rootDir, entry.rel), { force: true });
        deletedPaths.push(entry.rel);
      }
      const diff = await execa("git", ["diff", "--no-color", "HEAD", "--", ...deletedPaths], {
        cwd: rootDir,
        reject: false,
      });
      const patch = diff.stdout?.trim();
      if (patch) {
        const header = [
          "# RepoDiet cleanup patch",
          "# Valid unified diff — apply with: git apply repodiet-cleanup.patch",
          `# Safe deletions: ${deletedPaths.length}`,
          "# Generator: git-cli",
          "",
        ].join("\n");
        return {
          patch: `${header}\n${patch}\n`,
          deletedPaths,
        };
      }
      // Restore files before pure-JS fallback so callers still see originals on disk.
      for (const entry of entries) {
        const fullPath = path.join(rootDir, entry.rel);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, entry.content, "utf8");
      }
    }
  }

  return buildPureJsDeleteBundle(entries);
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
