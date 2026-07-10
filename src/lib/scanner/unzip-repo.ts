import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

const MAX_DECOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_FILE_COUNT = 20_000;

function isSafeRelativePath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.includes("\0")) return false;
  const parts = normalized.split("/");
  return !parts.some((part) => part === ".." || part === "");
}

function resolveSafePath(destDir: string, relativePath: string): string | null {
  if (!isSafeRelativePath(relativePath)) return null;
  const resolved = path.resolve(destDir, relativePath);
  const destResolved = path.resolve(destDir);
  if (!resolved.startsWith(destResolved + path.sep) && resolved !== destResolved) {
    return null;
  }
  return resolved;
}

export async function unzipRepoToDir(
  buffer: ArrayBuffer,
  destDir: string
): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const rootEntries = new Set<string>();
  let totalBytes = 0;
  let fileCount = 0;

  for (const entryName of Object.keys(zip.files)) {
    const top = entryName.split("/")[0];
    if (top) rootEntries.add(top);
  }

  if (rootEntries.size === 0) {
    throw new Error("ZIP archive appears empty.");
  }

  const rootFolder = [...rootEntries][0];
  const extractRoot = path.join(destDir, rootFolder);

  await fs.mkdir(destDir, { recursive: true });

  const writes: Promise<void>[] = [];

  for (const [relativePath, file] of Object.entries(zip.files)) {
    if (file.dir) continue;

    const safePath = resolveSafePath(destDir, relativePath);
    if (!safePath) {
      throw new Error(`Unsafe ZIP entry rejected: ${relativePath}`);
    }

    fileCount += 1;
    if (fileCount > MAX_FILE_COUNT) {
      throw new Error(`ZIP exceeds maximum file count (${MAX_FILE_COUNT}).`);
    }

    const content = await file.async("nodebuffer");
    totalBytes += content.byteLength;
    if (totalBytes > MAX_DECOMPRESSED_BYTES) {
      throw new Error(`ZIP exceeds maximum decompressed size (${MAX_DECOMPRESSED_BYTES} bytes).`);
    }

    await fs.mkdir(path.dirname(safePath), { recursive: true });
    writes.push(fs.writeFile(safePath, content));
  }

  await Promise.all(writes);
  return extractRoot;
}
