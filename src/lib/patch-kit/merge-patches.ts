import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { execa } from "execa";
import { EMPTY_CLEANUP_PATCH } from "./generate-cleanup-patch";
import { extractApplyablePatch } from "./validate-patch";
import { copyRepoBaseline } from "./generate-unified-diff";
import { hashSource } from "@/lib/execution/transform-audit";
import { patchHasApplyableOperations } from "./validate-patch";

export interface ConsolidatedEdit {
  path: string;
  content: string;
  /** Hash of file content at scan baseline — used to detect GitHub drift before PR delivery. */
  baselineContentHash?: string;
}

/**
 * Build consolidated edits by diffing workspace final state against pristine baseline.
 * More reliable than merging per-attempt modifiedSources when many fixes touch the same file.
 */
export async function buildConsolidatedEditsFromWorkspace(
  baselineRoot: string,
  workspaceRoot: string,
  changedPaths: string[]
): Promise<ConsolidatedEdit[]> {
  const edits: ConsolidatedEdit[] = [];
  const seen = new Set<string>();

  for (const raw of changedPaths) {
    const rel = raw.replace(/\\/g, "/").replace(/^\.\//, "");
    if (seen.has(rel)) continue;
    seen.add(rel);

    const baselinePath = path.join(baselineRoot, rel);
    const workspacePath = path.join(workspaceRoot, rel);
    const baselineContent = await fs.readFile(baselinePath, "utf8").catch(() => null);
    const finalContent = await fs.readFile(workspacePath, "utf8").catch(() => null);

    if (finalContent === null && baselineContent !== null) {
      edits.push({ path: rel, content: "" });
    } else if (finalContent !== null && baselineContent !== finalContent) {
      edits.push({ path: rel, content: finalContent });
    }
  }

  return edits;
}

/** Last edit per path wins — supports multiple fixes on the same file. */
export function dedupeConsolidatedEdits(edits: ConsolidatedEdit[]): ConsolidatedEdit[] {
  const byPath = new Map<string, ConsolidatedEdit>();
  for (const edit of edits) {
    const normalizedPath = edit.path.replace(/\\/g, "/").replace(/^\.\//, "");
    byPath.set(normalizedPath, {
      path: normalizedPath,
      content: edit.content,
      baselineContentHash: edit.baselineContentHash,
    });
  }
  return Array.from(byPath.values());
}

const WORKSPACE_SKIP_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", ".turbo"]);

async function listWorkspaceFiles(rootDir: string, rel = ""): Promise<string[]> {
  const full = path.join(rootDir, rel);
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(full, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const ent of entries) {
    if (WORKSPACE_SKIP_DIRS.has(ent.name)) continue;
    const childRel = rel ? `${rel}/${ent.name}` : ent.name;
    const normalized = childRel.replace(/\\/g, "/");
    if (ent.isDirectory()) {
      files.push(...(await listWorkspaceFiles(rootDir, normalized)));
    } else if (ent.isFile()) {
      files.push(normalized);
    }
  }
  return files;
}

/**
 * Diff pristine baseline vs modified workspace into final file contents.
 * Authoritative source for consolidated patches after sequential fix application.
 */
export async function collectEditsBetweenWorkspaces(
  baselineRoot: string,
  modifiedRoot: string
): Promise<ConsolidatedEdit[]> {
  const baselineFiles = new Set(await listWorkspaceFiles(baselineRoot));
  const modifiedFiles = new Set(await listWorkspaceFiles(modifiedRoot));
  const allPaths = new Set([...baselineFiles, ...modifiedFiles]);
  const edits: ConsolidatedEdit[] = [];

  for (const rel of allPaths) {
    const basePath = path.join(baselineRoot, rel);
    const modPath = path.join(modifiedRoot, rel);
    const baseContent = await fs.readFile(basePath, "utf8").catch(() => null);
    const modContent = await fs.readFile(modPath, "utf8").catch(() => null);
    if (baseContent === modContent) continue;
    if (modContent === null) {
      edits.push({
        path: rel,
        content: "",
        baselineContentHash: baseContent !== null ? hashSource(baseContent) : hashSource(""),
      });
    } else {
      edits.push({
        path: rel,
        content: modContent,
        baselineContentHash: baseContent !== null ? hashSource(baseContent) : hashSource(""),
      });
    }
  }

  return dedupeConsolidatedEdits(edits);
}

/** Keep only edits that differ from the pristine baseline snapshot. */
export async function filterEditsAgainstBaseline(
  baselineRoot: string,
  edits: ConsolidatedEdit[]
): Promise<ConsolidatedEdit[]> {
  const filtered: ConsolidatedEdit[] = [];
  for (const edit of dedupeConsolidatedEdits(edits)) {
    const baseContent = await fs.readFile(path.join(baselineRoot, edit.path), "utf8").catch(() => null);
    if (edit.content === "") {
      if (baseContent !== null) filtered.push(edit);
      continue;
    }
    if (baseContent !== edit.content) filtered.push(edit);
  }
  return filtered;
}

/** Fallback unified diff built per file when git repository diff is unavailable. */
export async function buildManualPatchFromEdits(
  baselineRoot: string,
  edits: ConsolidatedEdit[]
): Promise<{ patch: string; changedPaths: string[] }> {
  const { buildTextDiff } = await import("@/lib/execution/fix-preflight");
  const deduped = dedupeConsolidatedEdits(edits);
  const sections: string[] = [];
  const changedPaths: string[] = [];

  for (const edit of deduped) {
    const rel = edit.path;
    const basePath = path.join(baselineRoot, rel);
    const original = await fs.readFile(basePath, "utf8").catch(() => null);
    if (edit.content === "") {
      if (original === null) continue;
      const section = buildTextDiff(rel, original, "");
      if (section.trim()) {
        sections.push(section);
        changedPaths.push(rel);
      }
      continue;
    }
    if (original === edit.content) continue;
    const section = buildTextDiff(rel, original ?? "", edit.content);
    if (section.trim()) {
      sections.push(section);
      changedPaths.push(rel);
    }
  }

  if (sections.length === 0) {
    return { patch: EMPTY_CLEANUP_PATCH, changedPaths: [] };
  }

  const patch = mergeCleanupPatches(...sections);
  const header = [
    "# RepoDiet cleanup patch",
    "# Consolidated unified diff — apply with: git apply repodiet-cleanup.patch",
    `# Edited paths: ${changedPaths.length}`,
    "",
  ].join("\n");

  return {
    patch: ensurePatchTrailingNewline(`${header}\n${extractApplyablePatch(patch)}`),
    changedPaths,
  };
}

async function diffPathsWithNoIndex(
  baselineRoot: string,
  modifiedRoot: string,
  rel: string
): Promise<string> {
  const basePath = path.join(baselineRoot, rel);
  const modPath = path.join(modifiedRoot, rel);
  const baseExists = await fs.access(basePath).then(() => true).catch(() => false);
  const modExists = await fs.access(modPath).then(() => true).catch(() => false);

  if (!baseExists && !modExists) return "";
  if (baseExists && !modExists) {
    const result = await execa("git", ["diff", "--no-index", "--no-color", basePath, "/dev/null"], {
      reject: false,
    });
    return (result.stdout || result.stderr || "").trim();
  }
  if (!baseExists && modExists) {
    const result = await execa("git", ["diff", "--no-index", "--no-color", "/dev/null", modPath], {
      reject: false,
    });
    return (result.stdout || result.stderr || "").trim();
  }

  const result = await execa("git", ["diff", "--no-index", "--no-color", basePath, modPath], {
    reject: false,
  });
  return (result.stdout || "").trim();
}

/**
 * Build patch from the actual modified workspace (authoritative) with git and manual fallbacks.
 */
export async function buildPatchFromWorkspaceDelta(
  baselineRoot: string,
  modifiedRoot: string,
  workDir: string
): Promise<{ patch: string; changedPaths: string[]; edits: ConsolidatedEdit[] }> {
  const edits = await filterEditsAgainstBaseline(
    baselineRoot,
    await collectEditsBetweenWorkspaces(baselineRoot, modifiedRoot)
  );

  if (edits.length === 0) {
    return { patch: EMPTY_CLEANUP_PATCH, changedPaths: [], edits: [] };
  }

  const { buildCanonicalRepositoryPatch } = await import("./canonical-patch");
  const canonical = await buildCanonicalRepositoryPatch(baselineRoot, edits, workDir);
  if (patchHasApplyableOperations(canonical.patch)) {
    return { patch: canonical.patch, changedPaths: canonical.changedPaths, edits };
  }

  const gitPatch = await buildConsolidatedPatchFromEdits(baselineRoot, edits, workDir);
  if (patchHasApplyableOperations(gitPatch.patch)) {
    return { ...gitPatch, edits };
  }

  return { patch: EMPTY_CLEANUP_PATCH, changedPaths: [], edits };
}

/** Fallback when workspace walk misses retained in-memory edits. */
export function buildEditsFromRetainedAttempts(
  attempts: Array<{
    status: string;
    changedPaths: string[];
    modifiedSources?: Record<string, string>;
  }>
): ConsolidatedEdit[] {
  const edits: ConsolidatedEdit[] = [];
  for (const attempt of attempts) {
    if (attempt.status !== "retained") continue;
    for (const rel of attempt.changedPaths) {
      const normalized = rel.replace(/\\/g, "/").replace(/^\.\//, "");
      const content = attempt.modifiedSources?.[rel] ?? attempt.modifiedSources?.[normalized];
      if (content !== undefined) {
        edits.push({ path: normalized, content });
      }
    }
  }
  return dedupeConsolidatedEdits(edits);
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

  const diff = await execa(
    "git",
    [
      "diff",
      "--binary",
      "--full-index",
      "--no-ext-diff",
      "--no-renames",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      "HEAD",
      "--",
      ".",
    ],
    {
      cwd: scratchRoot,
      reject: false,
    }
  );

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
