import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import type { Finding } from "@/lib/findings/types";
import { isDoNotTouchPath, isRouteLikePath } from "@/lib/findings/confidence-path-rules";
import {
  detectUnusedImportsInFile,
  type UnusedImportCandidate,
} from "@/lib/findings/unused-import-detector";
import { clampConfidence, severityForAction } from "@/lib/findings/confidence";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "coverage",
  ".turbo",
]);

async function collectSourceFiles(rootDir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(absDir: string, relDir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(path.join(absDir, entry.name), rel);
      } else if (/\.(tsx?|jsx?|mjs|cjs)$/.test(entry.name)) {
        if (!isDoNotTouchPath(rel) && !isRouteLikePath(rel)) {
          results.push(rel);
        }
      }
    }
  }

  await walk(rootDir, "");
  return results.sort();
}

export async function enrichFindingsWithUnusedImports(
  rootDir: string,
  existing: Finding[]
): Promise<Finding[]> {
  const paths = new Set<string>();
  for (const f of existing) {
    for (const file of f.files) {
      if (/\.(tsx?|jsx?)$/.test(file) && !isDoNotTouchPath(file) && !isRouteLikePath(file)) {
        paths.add(file);
      }
    }
  }

  for (const rel of await collectSourceFiles(rootDir)) {
    paths.add(rel);
  }

  const seen = new Set<string>();
  const imports: Finding[] = [];
  for (const rel of paths) {
    const candidates = await detectUnusedImportsInFile(rootDir, rel);
    for (const c of candidates) {
      const key = `${c.file}::${c.symbol}`;
      if (seen.has(key)) continue;
      seen.add(key);
      imports.push(unusedImportFinding(c));
    }
  }
  return imports;
}

function unusedImportFinding(c: UnusedImportCandidate): Finding {
  const action = "safe_candidate" as const;
  return {
    id: `fnd_${nanoid(10)}`,
    type: "unused_import",
    title: `Unused import: ${c.symbol}`,
    files: [c.file],
    confidence: clampConfidence(0.88),
    confidenceReason: "Import symbol not referenced in module body; side-effect imports excluded.",
    severity: severityForAction(action),
    action,
    reason: `Import for "${c.symbol}" is not used in ${c.file}.`,
    source: "heuristic",
    sourceMode: "heuristic",
    evidence: {
      summary: "Deterministic unused import detection",
      signals: [`symbol=${c.symbol}`, `importLine=${c.line}`, `line=${c.lineNumber}`],
    },
  };
}
