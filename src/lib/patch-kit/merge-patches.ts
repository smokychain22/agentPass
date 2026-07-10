import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { execa } from "execa";
import { EMPTY_CLEANUP_PATCH } from "./generate-cleanup-patch";
import { extractApplyablePatch } from "./validate-patch";
import { copyRepoBaseline } from "./generate-unified-diff";

export interface ConsolidatedEdit {
  path: string;
  content: string;
}

/** Last edit per path wins — supports multiple fixes on the same file. */
export function dedupeConsolidatedEdits(edits: ConsolidatedEdit[]): ConsolidatedEdit[] {
  const byPath = new Map<string, string>();
  for (const edit of edits) {
    byPath.set(edit.path.replace(/\\/g, "/").replace(/^\.\//, ""), edit.content);
  }
  return Array.from(byPath.entries()).map(([path, content]) => ({ path, content }));
}

async function initGitBaseline(rootDir: string): Promise<void> {
  await execa("git", ["init"], { cwd: rootDir, reject: false });
  await execa("git", ["add", "-A"], { cwd: rootDir, reject: false });
  await execa(
    "git",
    [
      "-c",
      "user.email=repodiet@local",
      "-c",
      "user.name=RepoDiet",
      "commit",
      "-m",
      "repodiet-baseline",
      "--allow-empty",
    ],
    { cwd: rootDir, reject: false }
  );
}

/**
 * Build one git-valid unified diff from pristine baseline + final file contents.
 * Avoids broken concatenation when multiple retained fixes touch the same file.
 */
export async function buildConsolidatedPatchFromEdits(
  baselineRoot: string,
  edits: ConsolidatedEdit[],
  workDir: string
): Promise<{ patch: string; changedPaths: string[] }> {
  const deduped = dedupeConsolidatedEdits(edits);
  if (deduped.length === 0) {
    return { patch: EMPTY_CLEANUP_PATCH, changedPaths: [] };
  }

  const scratchRoot = path.join(workDir, `consolidated-${nanoid(8)}`);
  await copyRepoBaseline(baselineRoot, scratchRoot);
  await initGitBaseline(scratchRoot);

  const changedPaths: string[] = [];

  for (const edit of deduped) {
    const rel = edit.path;
    const full = path.join(scratchRoot, rel);
    if (edit.content === "") {
      try {
        await fs.access(full);
        await fs.rm(full, { force: true });
        changedPaths.push(rel);
      } catch {
        // already absent
      }
      continue;
    }

    await fs.mkdir(path.dirname(full), { recursive: true });
    const before = await fs.readFile(full, "utf8").catch(() => null);
    await fs.writeFile(full, edit.content, "utf8");
    const after = await fs.readFile(full, "utf8");
    if (before !== after) changedPaths.push(rel);
  }

  if (changedPaths.length === 0) {
    await fs.rm(scratchRoot, { recursive: true, force: true }).catch(() => {});
    return { patch: EMPTY_CLEANUP_PATCH, changedPaths: [] };
  }

  const diff = await execa("git", ["diff", "--no-color", "HEAD", "--", ...changedPaths], {
    cwd: scratchRoot,
    reject: false,
  });

  await fs.rm(scratchRoot, { recursive: true, force: true }).catch(() => {});

  const patch = (diff.stdout ?? "").trim();
  if (!patch) {
    return { patch: EMPTY_CLEANUP_PATCH, changedPaths: [] };
  }

  const header = [
    "# RepoDiet cleanup patch",
    "# Consolidated unified diff — apply with: git apply repodiet-cleanup.patch",
    `# Edited paths: ${changedPaths.length}`,
    "",
  ].join("\n");

  return {
    patch: ensurePatchTrailingNewline(`${header}\n${patch}`),
    changedPaths,
  };
}

/** Concatenate unified diff sections from multiple patch sources. */
export function ensurePatchTrailingNewline(patch: string): string {
  if (!patch.trim()) return patch;
  return patch.endsWith("\n") ? patch : `${patch}\n`;
}

/** Concatenate unified diff sections from multiple patch sources. */
export function mergeCleanupPatches(...patches: string[]): string {
  const sections: string[] = [];

  for (const patch of patches) {
    const trimmed = patch.trim();
    if (!trimmed || trimmed === EMPTY_CLEANUP_PATCH.trim()) continue;
    const applyable = extractApplyablePatch(trimmed);
    if (applyable.trim()) sections.push(applyable.trim());
  }

  if (sections.length === 0) return EMPTY_CLEANUP_PATCH;
  return ensurePatchTrailingNewline(sections.join("\n\n"));
}
