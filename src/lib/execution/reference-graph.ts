import fs from "node:fs/promises";
import path from "node:path";

const SOURCE_EXT = /\.(tsx?|jsx?|mjs|cjs)$/i;

function normalizeRel(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

function withoutSourceExtension(value: string): string {
  return value.replace(/\.(tsx?|jsx?|mjs|cjs)$/i, "");
}

export interface ModuleReference {
  specifier: string;
  start: number;
  end: number;
  line: number;
}

export function findModuleReferences(source: string): ModuleReference[] {
  const references: ModuleReference[] = [];
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[^;"']*?\s+from\s+)?["']([^"']+)["']/g,
    /\b(?:require|import)\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (!specifier || match.index === undefined) continue;
      const offset = match[0].lastIndexOf(specifier);
      if (offset < 0) continue;
      const start = match.index + offset;
      references.push({
        specifier,
        start,
        end: start + specifier.length,
        line: source.slice(0, start).split("\n").length,
      });
    }
  }
  return references
    .filter((reference, index, all) =>
      all.findIndex((candidate) =>
        candidate.start === reference.start && candidate.end === reference.end
      ) === index
    )
    .sort((left, right) => left.start - right.start);
}

export function moduleSpecifierTargetsFile(
  importerFile: string,
  specifier: string,
  targetRelPath: string
): boolean {
  const target = withoutSourceExtension(normalizeRel(targetRelPath));
  const normalizedSpecifier = normalizeRel(specifier);

  if (specifier.startsWith(".")) {
    const resolved = path.posix.normalize(
      path.posix.join(path.posix.dirname(normalizeRel(importerFile)), specifier)
    );
    return withoutSourceExtension(normalizeRel(resolved)) === target;
  }

  if (specifier.startsWith("@/")) {
    const aliasPath = withoutSourceExtension(normalizedSpecifier.slice(2));
    return aliasPath === target || aliasPath === target.replace(/^src\//, "");
  }

  return withoutSourceExtension(normalizedSpecifier) === target;
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
    count += findModuleReferences(source).filter((reference) =>
      moduleSpecifierTargetsFile(file, reference.specifier, target)
    ).length;
  }

  return count;
}

export async function findFilesImporting(
  rootDir: string,
  targetRelPath: string
): Promise<Array<{ file: string; lines: number[] }>> {
  const target = normalizeRel(targetRelPath);
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
    const lines = [...new Set(
      findModuleReferences(source)
        .filter((reference) =>
          moduleSpecifierTargetsFile(file, reference.specifier, target)
        )
        .map((reference) => reference.line)
    )];
    if (lines.length) hits.push({ file, lines });
  }

  return hits;
}
