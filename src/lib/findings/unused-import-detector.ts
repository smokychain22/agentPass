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
  const escaped = escapeRegExp(symbol);
  const wordRe = new RegExp(`\\b${escaped}\\b`);
  const jsxRe = new RegExp(`<${escaped}[\\s/>{]`);
  const typeRe = new RegExp(`:\\s*${escaped}\\b|${escaped}\\s*[|&<>,;)]`);
  return wordRe.test(body) || jsxRe.test(body) || typeRe.test(body);
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

function parseNamedImportBlock(block: string): {
  isTypeOnly: boolean;
  specifiers: string;
  fromClause: string;
} | null {
  const namedMatch = block.match(/import\s+(type\s+)?\{([^}]+)\}\s+from\s+(['"][^'"]+['"])/);
  if (!namedMatch) return null;
  return {
    isTypeOnly: Boolean(namedMatch[1]),
    specifiers: namedMatch[2],
    fromClause: namedMatch[3],
  };
}

function specifierMatchesSymbol(specifier: string, symbol: string): boolean {
  const withoutType = specifier.replace(/^type\s+/, "");
  const aliasParts = withoutType.split(/\s+as\s+/);
  const importName = aliasParts[0]?.trim() ?? "";
  const localName = (aliasParts[1] ?? aliasParts[0])?.trim() ?? "";
  return localName === symbol || importName === symbol;
}

function rebuildNamedImport(
  indent: string,
  parsed: { isTypeOnly: boolean; specifiers: string; fromClause: string },
  remaining: string[]
): string {
  const prefix = parsed.isTypeOnly ? "import type" : "import";
  return `${indent}${prefix} { ${remaining.join(", ")} } from ${parsed.fromClause};`;
}

export function removeUnusedSymbolAtLine(
  source: string,
  lineNumber: number,
  symbol: string
): string | null {
  const lines = source.split("\n");
  const idx = lineNumber - 1;
  if (idx < 0 || idx >= lines.length) return null;

  let block = lines[idx];
  let end = idx;
  while (!block.includes(";") && end + 1 < lines.length) {
    end += 1;
    block += `\n${lines[end]}`;
  }

  const modifiedBlock = removeUnusedSymbolFromImport(block, block.trim(), symbol);
  if (modifiedBlock === block) return null;

  const next = [...lines.slice(0, idx), ...modifiedBlock.split("\n"), ...lines.slice(end + 1)];
  const result = next.join("\n").replace(/\n{3,}/g, "\n\n");
  return result === source ? null : result;
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

    const parsed = parseNamedImportBlock(block);
    if (!parsed) {
      out.push(lines[i]);
      continue;
    }

    const parts = parsed.specifiers
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const remaining = parts.filter((p) => !specifierMatchesSymbol(p, symbol));

    if (remaining.length === 0) {
      continue;
    }

    const indent = lines[i].match(/^\s*/)?.[0] ?? "";
    out.push(rebuildNamedImport(indent, parsed, remaining));
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

/** Convert a named import specifier to `import type { ... }` when only used in type positions. */
export function convertSymbolToTypeOnlyImport(
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

    const namedMatch = block.match(/import\s+(type\s+)?\{([^}]+)\}\s+from\s+(['"][^'"]+['"])/);
    if (!namedMatch) {
      out.push(lines[i]);
      continue;
    }

    const parts = namedMatch[2]
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const updated = parts.map((p) => {
      const withoutType = p.replace(/^type\s+/, "");
      const aliasParts = withoutType.split(/\s+as\s+/);
      const importName = aliasParts[0]?.trim() ?? "";
      const localName = (aliasParts[1] ?? aliasParts[0])?.trim() ?? "";
      if (localName === symbol || importName === symbol) {
        return p.startsWith("type ") ? p : `type ${withoutType}`;
      }
      return p;
    });

    const indent = lines[i].match(/^\s*/)?.[0] ?? "";
    const fromClause = namedMatch[3];
    const allTypeOnly = updated.every((p) => p.startsWith("type "));
    const prefix = allTypeOnly ? "import type" : "import";
    const rebuilt = `${indent}${prefix} { ${updated.join(", ")} } from ${fromClause};`;
    out.push(rebuilt);
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}
