import fs from "node:fs/promises";
import path from "node:path";
import type { FileSummary } from "./types";
import { IGNORED_DIRS } from "./types";

export interface FileTreeScan {
  summary: FileSummary;
  topLevelFolders: string[];
  allRelativePaths: string[];
  largestFiles: { path: string; sizeKb: number }[];
}

function shouldIgnore(segment: string): boolean {
  return IGNORED_DIRS.has(segment);
}

export async function scanFileTree(rootDir: string): Promise<FileTreeScan> {
  let totalFiles = 0;
  let totalFolders = 0;
  let totalBytes = 0;
  const extensions: Record<string, number> = {};
  const allRelativePaths: string[] = [];
  const fileSizes: { path: string; size: number }[] = [];

  async function walk(current: string, relative: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      if (shouldIgnore(entry.name)) continue;

      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      const full = path.join(current, entry.name);

      if (entry.isDirectory()) {
        totalFolders += 1;
        await walk(full, rel);
      } else if (entry.isFile()) {
        totalFiles += 1;
        allRelativePaths.push(rel);
        const stat = await fs.stat(full);
        totalBytes += stat.size;
        fileSizes.push({ path: rel, size: stat.size });

        const ext = path.extname(entry.name).toLowerCase() || "(no ext)";
        extensions[ext] = (extensions[ext] ?? 0) + 1;
      }
    }
  }

  await walk(rootDir, "");

  const topLevelFolders: string[] = [];
  try {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !shouldIgnore(entry.name)) {
        topLevelFolders.push(entry.name);
      }
    }
  } catch {
    /* empty */
  }

  const topExtensions = Object.fromEntries(
    Object.entries(extensions)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
  );

  const largestFiles = fileSizes
    .sort((a, b) => b.size - a.size)
    .slice(0, 5)
    .map((f) => ({
      path: f.path,
      sizeKb: Math.round((f.size / 1024) * 10) / 10,
    }));

  return {
    summary: {
      totalFiles,
      totalFolders,
      totalSizeKb: Math.round(totalBytes / 1024),
      topExtensions,
    },
    topLevelFolders: topLevelFolders.sort(),
    allRelativePaths,
    largestFiles,
  };
}
