import fs from "node:fs/promises";
import path from "node:path";

const IMPORT_LINE =
  /^import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+))*\s+from\s+['"][^'"]+['"]|['"][^'"]+['"])\s*;?\s*$/;
const SIDE_EFFECT_IMPORT = /^import\s+['"][^'"]+['"]\s*;?\s*$/;

export interface UnusedImportCandidate {
  file: string;
  symbol: string;
  line: string;
  lineNumber: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function symbolUsedInBody(body: string, symbol: string): boolean {
  const re = new RegExp(`\\b${escapeRegExp(symbol)}\\b`);
  return re.test(body);
}

function parseNamedImports(importClause: string): string[] {
  const match = importClause.match(/\{([^}]+)\}/);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const withoutType = p.replace(/^type\s+/, "");
      const parts = withoutType.split(/\s+as\s+/);
      return (parts[1] ?? parts[0]).trim();
    });
}

export function detectUnusedImportsInSource(
  relPath: string,
  source: string
): UnusedImportCandidate[] {
  const lines = source.split("\n");
  const candidates: UnusedImportCandidate[] = [];
  const importBlocks: Array<{ start: number; end: number; text: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith("import ")) continue;
    if (SIDE_EFFECT_IMPORT.test(line.trim())) continue;

    let block = line;
    let end = i;
    while (!block.includes(";") && end + 1 < lines.length) {
      end += 1;
      block += `\n${lines[end]}`;
    }
    if (!IMPORT_LINE.test(block.replace(/\n/g, " ").trim()) && !block.includes("from")) {
      continue;
    }
    importBlocks.push({ start: i, end, text: block });
  }

  const bodyStart = importBlocks.length > 0 ? importBlocks[importBlocks.length - 1].end + 1 : 0;
  const body = lines.slice(bodyStart).join("\n");

  for (const block of importBlocks) {
    const text = block.text.replace(/\n/g, " ").trim();
    const defaultMatch = text.match(/^import\s+(\w+)\s+from\s+['"][^'"]+['"]/);
    if (defaultMatch) {
      const symbol = defaultMatch[1];
      if (!symbolUsedInBody(body, symbol)) {
        candidates.push({
          file: relPath,
          symbol,
          line: block.text.trim(),
          lineNumber: block.start + 1,
        });
      }
    }

    const named = parseNamedImports(text);
    const unusedNamed = named.filter((sym) => !symbolUsedInBody(body, sym));
    if (unusedNamed.length > 0 && named.length === unusedNamed.length) {
      candidates.push({
        file: relPath,
        symbol: unusedNamed.join(", "),
        line: block.text.trim(),
        lineNumber: block.start + 1,
      });
    } else if (unusedNamed.length > 0 && named.length > unusedNamed.length) {
      for (const sym of unusedNamed) {
        candidates.push({
          file: relPath,
          symbol: sym,
          line: block.text.trim(),
          lineNumber: block.start + 1,
        });
      }
    }
  }

  return candidates;
}

export async function detectUnusedImportsInFile(
  rootDir: string,
  relPath: string
): Promise<UnusedImportCandidate[]> {
  if (!/\.(tsx?|jsx?)$/.test(relPath)) return [];
  const full = path.join(rootDir, relPath);
  try {
    const source = await fs.readFile(full, "utf8");
    return detectUnusedImportsInSource(relPath, source);
  } catch {
    return [];
  }
}

export function removeUnusedImportLine(source: string, importLine: string): string {
  return removeUnusedSymbolFromImport(source, importLine, "");
}

export function removeUnusedSymbolFromImport(
  source: string,
  importLine: string,
  symbol: string
): string {
  const lines = source.split("\n");
  const normalized = importLine.replace(/\s+/g, " ").trim();
  const out: string[] = [];
  let skip = 0;

  for (let i = 0; i < lines.length; i++) {
    if (skip > 0) {
      skip -= 1;
      continue;
    }
    const chunk = lines.slice(i).join("\n");
    const multiLineEnd = chunk.indexOf(";");
    const block = multiLineEnd >= 0 ? chunk.slice(0, multiLineEnd + 1) : chunk.split("\n")[0];
    if (block.replace(/\s+/g, " ").trim() !== normalized) {
      out.push(lines[i]);
      continue;
    }

    const lineCount = block.split("\n").length;
    skip = lineCount - 1;

    if (!symbol) {
      continue;
    }

    const namedMatch = block.match(/import\s+\{([^}]+)\}\s+from\s+(['"][^'"]+['"])/);
    if (!namedMatch) {
      continue;
    }

    const parts = namedMatch[1]
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const remaining = parts.filter((p) => {
      const withoutType = p.replace(/^type\s+/, "");
      const local = (withoutType.split(/\s+as\s+/)[1] ?? withoutType.split(/\s+as\s+/)[0]).trim();
      return local !== symbol;
    });

    if (remaining.length === 0) {
      continue;
    }

    const indent = lines[i].match(/^\s*/)?.[0] ?? "";
    const fromClause = namedMatch[2];
    const rebuilt = `${indent}import { ${remaining.join(", ")} } from ${fromClause};`;
    out.push(rebuilt);
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}
