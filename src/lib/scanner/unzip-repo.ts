import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

export async function unzipRepoToDir(
  buffer: ArrayBuffer,
  destDir: string
): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const rootEntries = new Set<string>();

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
    const fullPath = path.join(destDir, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    writes.push(
      file.async("nodebuffer").then((content) => fs.writeFile(fullPath, content))
    );
  }

  await Promise.all(writes);
  return extractRoot;
}
