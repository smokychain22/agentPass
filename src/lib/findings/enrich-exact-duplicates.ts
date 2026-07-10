import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import type { Finding } from "./types";
import { isDoNotTouchPath, isRouteLikePath } from "./confidence-path-rules";
import { countInboundReferences } from "@/lib/execution/reference-graph";

const SOURCE_EXT = /\.(tsx?|jsx?|mjs|cjs)$/i;

function normalizeRel(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16);
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

export async function enrichExactDuplicateFindings(
  rootDir: string,
  existing: Finding[]
): Promise<Finding[]> {
  const files = await walkSourceFiles(rootDir);
  const byHash = new Map<string, string[]>();

  for (const rel of files) {
    if (isDoNotTouchPath(rel) || isRouteLikePath(rel)) continue;
    let content: string;
    try {
      content = await fs.readFile(path.join(rootDir, rel), "utf8");
    } catch {
      continue;
    }
    const h = hashContent(content);
    const group = byHash.get(h) ?? [];
    group.push(rel);
    byHash.set(h, group);
  }

  const existingPairs = new Set(
    existing
      .filter((f) => f.type === "duplicate_code")
      .map((f) => [...f.files].sort().join("|"))
  );

  const added: Finding[] = [];

  for (const [contentHash, group] of byHash) {
    if (group.length < 2) continue;
    const sorted = [...group].sort();
    const canonical = sorted[0]!;
    for (let i = 1; i < sorted.length; i++) {
      const duplicate = sorted[i]!;
      const pairKey = [canonical, duplicate].sort().join("|");
      if (existingPairs.has(pairKey)) continue;

      const inbound = await countInboundReferences(rootDir, duplicate);
      added.push({
        id: `fnd_exactdup_${nanoid(10)}`,
        type: "duplicate_code",
        title: `Exact duplicate file: ${duplicate}`,
        files: [canonical, duplicate],
        confidence: 0.95,
        confidenceReason: "Byte-identical file content hash match.",
        severity: "medium",
        action: "safe_candidate",
        reason: `${duplicate} is an exact duplicate of ${canonical}.`,
        source: "repodiet_exact_dup",
        sourceMode: "native",
        evidence: {
          summary: "Exact file duplicate detected by content hash.",
          signals: [
            "exact_file_duplicate=true",
            `content_hash=${contentHash}`,
            `canonical=${canonical}`,
            `duplicate=${duplicate}`,
            `inbound_refs_duplicate=${inbound}`,
            "classification=actionable_candidate",
          ],
        },
      });
      existingPairs.add(pairKey);
    }
  }

  return added;
}
