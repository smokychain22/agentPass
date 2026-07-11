import fs from "node:fs/promises";
import path from "node:path";

const SOURCE_EXTENSIONS = /\.(tsx?|jsx?|mjs|cjs)$/;

function packageImportPattern(pkgName: string): RegExp {
  const escaped = pkgName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:from|import)\\s+['"]${escaped}(?:/[^'"]*)?['"]|require\\(\\s*['"]${escaped}(?:/[^'"]*)?['"]\\s*\\)`,
    "m"
  );
}

async function walkSourceFiles(dir: string, files: string[]): Promise<void> {
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true }) as Array<{
      name: string;
      isDirectory(): boolean;
    }>;
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".next") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkSourceFiles(full, files);
      continue;
    }
    if (SOURCE_EXTENSIONS.test(entry.name)) files.push(full);
  }
}

export async function packageImportedInProject(
  rootDir: string,
  pkgName: string
): Promise<boolean> {
  const files: string[] = [];
  await walkSourceFiles(rootDir, files);
  const pattern = packageImportPattern(pkgName);
  for (const file of files) {
    try {
      const source = await fs.readFile(file, "utf8");
      if (pattern.test(source)) return true;
    } catch {
      // unreadable file
    }
  }
  return false;
}
