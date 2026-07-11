import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { dedupeConsolidatedEdits, type ConsolidatedEdit } from "./merge-patches";
import { patchHasApplyableOperations } from "./validate-patch";

const FILE_MODE = "100644";

/** Git blob object SHA-1 (required for `git apply --index` with --full-index). */
export function gitBlobSha(content: string): string {
  const body = Buffer.from(content, "utf8");
  const header = Buffer.from(`blob ${body.length}\0`);
  return createHash("sha1").update(Buffer.concat([header, body])).digest("hex");
}

function splitLines(content: string): string[] {
  if (!content) return [];
  const parts = content.split("\n");
  if (parts.at(-1) === "") parts.pop();
  return parts;
}

function buildFullReplaceHunk(beforeLines: string[], afterLines: string[]): string[] {
  const oldCount = Math.max(beforeLines.length, 0);
  const newCount = Math.max(afterLines.length, 0);
  const startOld = oldCount === 0 ? 0 : 1;
  const startNew = newCount === 0 ? 0 : 1;
  const lines: string[] = [`@@ -${startOld},${oldCount} +${startNew},${newCount} @@`];
  for (const line of beforeLines) lines.push(`-${line}`);
  for (const line of afterLines) lines.push(`+${line}`);
  return lines;
}

export function buildApplyableFilePatch(
  relPath: string,
  beforeContent: string | null,
  afterContent: string | null
): string | null {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\.\//, "");

  if (beforeContent !== null && afterContent !== null && beforeContent !== afterContent) {
    const beforeSha = gitBlobSha(beforeContent);
    const afterSha = gitBlobSha(afterContent);
    const beforeLines = splitLines(beforeContent);
    const afterLines = splitLines(afterContent);
    return [
      `diff --git a/${normalized} b/${normalized}`,
      `index ${beforeSha}..${afterSha} ${FILE_MODE}`,
      `--- a/${normalized}`,
      `+++ b/${normalized}`,
      ...buildFullReplaceHunk(beforeLines, afterLines),
    ].join("\n");
  }

  if (beforeContent !== null && afterContent === null) {
    const beforeSha = gitBlobSha(beforeContent);
    const beforeLines = splitLines(beforeContent);
    return [
      `diff --git a/${normalized} b/${normalized}`,
      `deleted file mode ${FILE_MODE}`,
      `index ${beforeSha}..0000000000000000000000000000000000000000`,
      `--- a/${normalized}`,
      `+++ /dev/null`,
      ...buildFullReplaceHunk(beforeLines, []),
    ].join("\n");
  }

  if (beforeContent === null && afterContent !== null) {
    const afterSha = gitBlobSha(afterContent);
    const afterLines = splitLines(afterContent);
    return [
      `diff --git a/dev/null b/${normalized}`,
      `new file mode ${FILE_MODE}`,
      `index 0000000000000000000000000000000000000000..${afterSha}`,
      `--- /dev/null`,
      `+++ b/${normalized}`,
      ...buildFullReplaceHunk([], afterLines),
    ].join("\n");
  }

  return null;
}

const PATCH_HEADER = [
  "# RepoDiet cleanup patch",
  "# Canonical repository diff — apply with: git apply --index repodiet-cleanup.patch",
  "",
].join("\n");

/**
 * Build a git-applyable unified diff without invoking the git CLI.
 * Used on serverless hosts (e.g. Vercel) where git is not installed.
 */
export async function buildApplyablePatchFromEdits(
  baselineRoot: string,
  edits: ConsolidatedEdit[]
): Promise<{ patch: string; changedPaths: string[] }> {
  const deduped = dedupeConsolidatedEdits(edits);
  const sections: string[] = [];
  const changedPaths: string[] = [];

  for (const edit of deduped) {
    const rel = edit.path.replace(/\\/g, "/").replace(/^\.\//, "");
    const basePath = path.join(baselineRoot, rel);
    const beforeContent = await fs.readFile(basePath, "utf8").catch(() => null);
    const afterContent = edit.content === "" ? null : edit.content;
    const section = buildApplyableFilePatch(rel, beforeContent, afterContent);
    if (!section) continue;
    sections.push(section);
    changedPaths.push(rel);
  }

  if (sections.length === 0) {
    return { patch: "", changedPaths: [] };
  }

  const patch = `${PATCH_HEADER}${sections.join("\n")}\n`;
  if (!patchHasApplyableOperations(patch)) {
    return { patch: "", changedPaths: [] };
  }

  return { patch, changedPaths };
}
