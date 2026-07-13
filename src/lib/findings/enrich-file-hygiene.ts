import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import type { Finding } from "./types";
import { isDoNotTouchPath, isRouteLikePath } from "./confidence-path-rules";
import { countInboundReferences } from "@/lib/execution/reference-graph";

function isEmptySource(content: string): boolean {
  return content.trim().length === 0;
}

/** Whitespace or comment-only source (no executable statements). */
function isEffectivelyEmptySource(content: string): boolean {
  if (isEmptySource(content)) return true;
  const withoutComments = content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .trim();
  return withoutComments.length === 0;
}

export async function enrichFileHygieneFindings(
  rootDir: string,
  findings: Finding[]
): Promise<Finding[]> {
  const out: Finding[] = [];

  for (const finding of findings) {
    if (finding.type === "unused_file" && finding.files[0]) {
      const rel = finding.files[0];
      const inbound = await countInboundReferences(rootDir, rel);
      const signals = [
        ...finding.evidence.signals.filter((s) => !s.startsWith("inbound_refs=")),
        `inbound_refs=${inbound}`,
      ];
      try {
        const content = await fs.readFile(path.join(rootDir, rel), "utf8");
        if (isEffectivelyEmptySource(content) && !signals.includes("empty_file=true")) {
          signals.push("empty_file=true");
        }
      } catch {
        /* unreadable */
      }
      out.push({
        ...finding,
        evidence: { ...finding.evidence, signals },
      });
      continue;
    }
    out.push(finding);
  }

  const seen = new Set(out.map((f) => f.files[0]).filter(Boolean) as string[]);

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".next") continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(rootDir, full).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!/\.(tsx?|jsx?|mjs|cjs)$/i.test(entry.name)) continue;
      if (seen.has(rel)) continue;
      if (isDoNotTouchPath(rel) || isRouteLikePath(rel)) continue;
      let content: string;
      try {
        content = await fs.readFile(full, "utf8");
      } catch {
        continue;
      }
      if (!isEffectivelyEmptySource(content)) continue;
      const inbound = await countInboundReferences(rootDir, rel);
      if (inbound > 0) continue;
      seen.add(rel);
      out.push({
        id: `fnd_empty_${nanoid(10)}`,
        type: "unused_file",
        title: `Empty file: ${rel}`,
        files: [rel],
        confidence: 0.9,
        confidenceReason: "File contains no source code.",
        severity: "low",
        action: "safe_candidate",
        reason: "Whitespace-only or empty source file with no inbound references.",
        source: "repodiet_hygiene",
        sourceMode: "native",
        evidence: {
          summary: "Empty source file detected.",
          signals: ["empty_file=true", `inbound_refs=${inbound}`],
        },
      });
    }
  }

  await walk(rootDir);
  return out;
}
