import fs from "node:fs/promises";
import path from "node:path";
import type { JscpdRawReport } from "../types";
import { IGNORED_DIRS } from "@/lib/scanner/types";

const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const MIN_CHUNK_LINES = 15;
const MIN_CHUNK_CHARS = 80;
const MAX_FILES = 400;

function isImportOnlyChunk(chunk: string): boolean {
  const lines = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return true;
  return lines.every(
    (line) =>
      line.startsWith("import ") ||
      line.startsWith("export ") && line.includes(" from ") ||
      line.startsWith("//") ||
      line === "{" ||
      line === "}" ||
      line === ");"
  );
}

function normalizeLines(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "").trim())
    .filter((line) => line.length > 0);
}

async function walkFiles(rootDir: string): Promise<{ rel: string; lines: string[] }[]> {
  const out: { rel: string; lines: string[] }[] = [];

  async function walk(dir: string, rel: string): Promise<void> {
    if (out.length >= MAX_FILES) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const relative = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(full, relative);
      } else if (entry.isFile() && CODE_EXT.has(path.extname(entry.name).toLowerCase())) {
        try {
          const content = await fs.readFile(full, "utf8");
          out.push({ rel: relative.replace(/\\/g, "/"), lines: normalizeLines(content) });
        } catch {
          /* skip */
        }
      }
    }
  }

  await walk(rootDir, "");
  return out;
}

export async function runDuplicateFallback(rootDir: string): Promise<JscpdRawReport> {
  const files = await walkFiles(rootDir);
  const chunkMap = new Map<string, { file: string; start: number; end: number }[]>();

  for (const file of files) {
    for (let i = 0; i <= file.lines.length - MIN_CHUNK_LINES; i++) {
      const chunk = file.lines.slice(i, i + MIN_CHUNK_LINES).join("\n");
      if (chunk.length < MIN_CHUNK_CHARS) continue;
      if (isImportOnlyChunk(chunk)) continue;
      const key = chunk;
      const list = chunkMap.get(key) ?? [];
      list.push({ file: file.rel, start: i + 1, end: i + MIN_CHUNK_LINES });
      chunkMap.set(key, list);
    }
  }

  const duplicates: JscpdRawReport["duplicates"] = [];
  const seen = new Set<string>();

  for (const occurrences of chunkMap.values()) {
    if (occurrences.length < 2) continue;
    const byFile = new Map<string, { file: string; start: number; end: number }>();
    for (const o of occurrences) byFile.set(o.file, o);
    const unique = [...byFile.values()];
    if (unique.length < 2) continue;

    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const a = unique[i];
        const b = unique[j];
        const key = [a.file, b.file].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        duplicates.push({
          lines: a.end - a.start + 1,
          firstFile: { name: a.file, start: a.start, end: a.end },
          secondFile: { name: b.file, start: b.start, end: b.end },
        });
      }
    }
  }

  return { duplicates: duplicates.slice(0, 50) };
}
