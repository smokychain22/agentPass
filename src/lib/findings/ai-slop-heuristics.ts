import fs from "node:fs/promises";
import path from "node:path";
import type { SlopRawSignal } from "./types";
import { IGNORED_DIRS } from "@/lib/scanner/types";
import { MAX_SLOP_FILES, SKIP_EXTENSIONS } from "./types";
import { clampConfidence, normalizeRepoPath } from "./confidence";

const SLOP_FILE_PATTERNS: RegExp[] = [
  /(?:Old|New|Final|Backup|Copy\d*|Test|temp)\.(tsx?|jsx?|mjs|cjs)$/i,
  /Button\d+\.(tsx?|jsx?)$/i,
  /Component(?:New|Final|Copy)\.(tsx?|jsx?)$/i,
  /page-old\.(tsx?|jsx?)$/i,
  /-backup\.(tsx?|jsx?|ts|js)$/i,
  /-unused\.(tsx?|jsx?)$/i,
  /(?:^|\/)utils\d*\.(tsx?|ts)$/i,
];

const SLOP_FOLDER_PATTERN = /(^|\/)(archive|backup|old|unused|tmp|temp|demo-unused)(\/|$)/i;

const TODO_PATTERN = /(?:TODO|FIXME|HACK|XXX|PLACEHOLDER)\s*[:—-]/i;
const GENERATED_COMMENT = /@generated|auto-?generated|do not edit/i;

async function walkCodeFiles(
  rootDir: string,
  onFile: (rel: string, content: string) => void | Promise<void>
): Promise<number> {
  let count = 0;

  async function walk(dir: string, rel: string): Promise<void> {
    if (count >= MAX_SLOP_FILES) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const relative = rel ? `${rel}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        await walk(full, relative);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SKIP_EXTENSIONS.has(ext)) continue;
        if (![".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) continue;
        count += 1;
        if (count > MAX_SLOP_FILES) return;
        try {
          const content = await fs.readFile(full, "utf8");
          await onFile(relative.replace(/\\/g, "/"), content);
        } catch {
          /* unreadable */
        }
      }
    }
  }

  await walk(rootDir, "");
  return count;
}

function groupSimilarNames(files: string[]): Map<string, string[]> {
  const byDir = new Map<string, string[]>();
  for (const f of files) {
    const dir = path.dirname(f);
    const base = path.basename(f, path.extname(f)).replace(/\d+$|(?:New|Old|Final|Copy\d*)$/i, "");
    const key = `${dir}::${base.toLowerCase()}`;
    const list = byDir.get(key) ?? [];
    list.push(f);
    byDir.set(key, list);
  }
  const clusters = new Map<string, string[]>();
  for (const [, list] of byDir) {
    if (list.length >= 2) {
      clusters.set(list.sort().join("|"), list);
    }
  }
  return clusters;
}

export async function runAiSlopHeuristics(rootDir: string): Promise<SlopRawSignal[]> {
  const signals: SlopRawSignal[] = [];
  const allFiles: string[] = [];
  const todoFiles: string[] = [];
  const generatedFiles: string[] = [];
  const slopNamedFiles: string[] = [];
  const slopFolderFiles: string[] = [];

  await walkCodeFiles(rootDir, async (rel, content) => {
    allFiles.push(rel);
    if (SLOP_FILE_PATTERNS.some((p) => p.test(rel))) slopNamedFiles.push(rel);
    if (SLOP_FOLDER_PATTERN.test(rel)) slopFolderFiles.push(rel);
    if (TODO_PATTERN.test(content)) todoFiles.push(rel);
    if (GENERATED_COMMENT.test(content)) generatedFiles.push(rel);
  });

  if (slopNamedFiles.length > 0) {
    signals.push({
      title: "Versioned or iterative file names",
      files: slopNamedFiles.slice(0, 20),
      reason:
        "Files with Old/New/Final/Backup/Copy suffixes suggest AI-generated iteration leftovers.",
      confidence: clampConfidence(0.72 + Math.min(slopNamedFiles.length, 5) * 0.02),
    });
  }

  if (slopFolderFiles.length > 0) {
    signals.push({
      title: "Archive or backup folder contents",
      files: slopFolderFiles.slice(0, 20),
      reason: "Files inside archive/backup/old/unused/tmp folders are often safe cleanup targets.",
      confidence: clampConfidence(0.78),
    });
  }

  for (const [, cluster] of groupSimilarNames(allFiles)) {
    signals.push({
      title: "Similar component names in same folder",
      files: cluster,
      reason: "Multiple near-identical component names in one folder suggest duplicate AI iterations.",
      confidence: clampConfidence(0.68 + cluster.length * 0.03),
    });
  }

  if (todoFiles.length > 0) {
    signals.push({
      title: "Placeholder TODO blocks",
      files: todoFiles.slice(0, 15),
      reason: "TODO/FIXME/PLACEHOLDER markers often indicate unfinished AI-generated stubs.",
      confidence: clampConfidence(0.55 + Math.min(todoFiles.length, 8) * 0.02),
    });
  }

  if (generatedFiles.length > 0) {
    signals.push({
      title: "Generated file markers",
      files: generatedFiles.slice(0, 10),
      reason: "Auto-generated comments detected — verify before manual edits or deletion.",
      confidence: clampConfidence(0.6),
    });
  }

  const routeHandlers = allFiles.filter((f) =>
    /(^|\/)app\/api\/.*\/route\.(tsx?|jsx?)$/.test(f)
  );
  const routeNames = routeHandlers.map((f) => path.basename(path.dirname(f)));
  const dupRoutes = routeNames.filter(
    (name, i, arr) => arr.indexOf(name) !== i
  );
  if (dupRoutes.length > 0) {
    const files = routeHandlers.filter((f) =>
      dupRoutes.includes(path.basename(path.dirname(f)))
    );
    signals.push({
      title: "Duplicate API route folder patterns",
      files,
      reason: "Multiple API route handlers with similar folder names may be orphaned experiments.",
      confidence: clampConfidence(0.65),
    });
  }

  return signals;
}

export { normalizeRepoPath };
