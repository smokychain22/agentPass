import fs from "node:fs/promises";
import path from "node:path";

const SOURCE_EXT = /\.(tsx?|jsx?|mjs|cjs)$/i;

function normalizeRel(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

function moduleSpecifiersForTarget(relPath: string): string[] {
  const norm = normalizeRel(relPath);
  const noExt = norm.replace(/\.(tsx?|jsx?|mjs|cjs)$/i, "");
  const base = path.basename(norm);
  const baseNoExt = base.replace(/\.(tsx?|jsx?|mjs|cjs)$/i, "");
  return [
    norm,
    `./${norm}`,
    `../${norm}`,
    noExt,
    `./${noExt}`,
    base,
    baseNoExt,
    `@/${noExt}`,
    `@/${norm}`,
  ];
}

async function walkSourceFiles(rootDir: string, dir = rootDir): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".next") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkSourceFiles(rootDir, full)));
    } else if (SOURCE_EXT.test(entry.name)) {
      out.push(normalizeRel(path.relative(rootDir, full)));
    }
  }
  return out;
}

export async function countInboundReferences(
  rootDir: string,
  targetRelPath: string
): Promise<number> {
  const target = normalizeRel(targetRelPath);
  const specs = new Set(moduleSpecifiersForTarget(target));
  const files = await walkSourceFiles(rootDir);
  let count = 0;

  for (const file of files) {
    if (file === target) continue;
    let source: string;
    try {
      source = await fs.readFile(path.join(rootDir, file), "utf8");
    } catch {
      continue;
    }
    for (const line of source.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("import ") && !trimmed.includes("require(")) continue;
      for (const spec of specs) {
        if (
          trimmed.includes(`'${spec}'`) ||
          trimmed.includes(`"${spec}"`) ||
          trimmed.includes(`'${spec}.`) ||
          trimmed.includes(`"${spec}.`)
        ) {
          count += 1;
          break;
        }
      }
    }
  }

  return count;
}

export async function findFilesImporting(
  rootDir: string,
  targetRelPath: string
): Promise<Array<{ file: string; lines: number[] }>> {
  const target = normalizeRel(targetRelPath);
  const specs = new Set(moduleSpecifiersForTarget(target));
  const files = await walkSourceFiles(rootDir);
  const hits: Array<{ file: string; lines: number[] }> = [];

  for (const file of files) {
    if (file === target) continue;
    let source: string;
    try {
      source = await fs.readFile(path.join(rootDir, file), "utf8");
    } catch {
      continue;
    }
    const lines: number[] = [];
    source.split("\n").forEach((line, idx) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("import ") && !trimmed.includes("require(")) return;
      for (const spec of specs) {
        if (trimmed.includes(`'${spec}'`) || trimmed.includes(`"${spec}"`)) {
          lines.push(idx + 1);
          break;
        }
      }
    });
    if (lines.length) hits.push({ file, lines });
  }

  return hits;
}
