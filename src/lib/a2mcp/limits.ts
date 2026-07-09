import fs from "node:fs/promises";
import path from "node:path";
import { MAX_FILES_ANALYZED, MAX_SINGLE_FILE_BYTES } from "./constants";
import { ToolExecutionError } from "./errors";

export async function countRepoFiles(rootDir: string): Promise<number> {
  let count = 0;

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (["node_modules", ".git", ".next", "dist", "build"].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        count += 1;
        if (count > MAX_FILES_ANALYZED) return;
        const stat = await fs.stat(full);
        if (stat.size > MAX_SINGLE_FILE_BYTES) {
          throw new ToolExecutionError(
            "REPO_TOO_LARGE",
            `File "${path.relative(rootDir, full)}" exceeds the 500KB single-file read limit.`
          );
        }
      }
    }
  }

  await walk(rootDir);
  return count;
}

export function assertZipSize(byteLength: number): void {
  const maxMb = 25;
  if (byteLength > maxMb * 1024 * 1024) {
    throw new ToolExecutionError(
      "REPO_TOO_LARGE",
      `Repository ZIP exceeds the ${maxMb}MB analysis limit.`
    );
  }
}

export function assertFileCount(count: number): void {
  if (count > MAX_FILES_ANALYZED) {
    throw new ToolExecutionError(
      "REPO_TOO_LARGE",
      `Repository exceeds the ${MAX_FILES_ANALYZED} file analysis limit.`
    );
  }
}
