import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { prepareRepoWorkspace } from "@/lib/scanner/prepare-workspace";
import { createScanWorkspace, removeWorkspace } from "@/lib/server/workspace";
import { copyRepoBaseline } from "./generate-unified-diff";
import { dedupeConsolidatedEdits, type ConsolidatedEdit } from "./merge-patches";

export interface PatchValidationResult {
  status: "passed" | "failed" | "skipped" | "not_generated";
  error?: string;
}

const DELETE_MARKERS = [/^deleted file mode /m];

export function patchHasApplyableOperations(patch: string): boolean {
  return /^diff --git /m.test(extractApplyablePatch(patch));
}

/** @deprecated Use patchHasApplyableOperations */
export function patchHasDeleteOperations(patch: string): boolean {
  return patchHasApplyableOperations(patch) && DELETE_MARKERS.some((pattern) => pattern.test(patch));
}

/** Strip comment header lines before applying patch. */
export function extractApplyablePatch(patch: string): string {
  const lines = patch.split("\n");
  const start = lines.findIndex((line) => line.startsWith("diff --git "));
  if (start === -1) return patch;
  return lines.slice(start).join("\n");
}

async function gitBaseline(rootDir: string): Promise<void> {
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
      "baseline",
      "--allow-empty",
    ],
    { cwd: rootDir, reject: false }
  );
}

export async function validateConsolidatedEditsInWorkspace(
  baselineRoot: string,
  edits: ConsolidatedEdit[]
): Promise<PatchValidationResult> {
  const deduped = dedupeConsolidatedEdits(edits);
  if (deduped.length === 0) {
    return { status: "skipped", error: "No consolidated edits to validate." };
  }

  const workspace = await createScanWorkspace("validate-edits");
  const validateRoot = path.join(workspace.artifactsPath, "root");

  try {
    await copyRepoBaseline(baselineRoot, validateRoot);
    for (const edit of deduped) {
      const full = path.join(validateRoot, edit.path);
      if (edit.content === "") {
        await fs.rm(full, { force: true }).catch(() => {});
        continue;
      }
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, edit.content, "utf8");
    }
    return { status: "passed" };
  } catch (err) {
    return {
      status: "failed",
      error: err instanceof Error ? err.message : "Consolidated edit validation failed.",
    };
  } finally {
    await removeWorkspace(workspace.root).catch(() => {});
  }
}

export async function validateCleanupPatchInWorkspace(
  rootDir: string,
  patch: string
): Promise<PatchValidationResult> {
  if (!patchHasApplyableOperations(patch)) {
    return { status: "skipped", error: "No applyable patch operations." };
  }

  const applyable = extractApplyablePatch(patch);
  const workspace = await createScanWorkspace("validate");
  const patchFile = path.join(workspace.artifactsPath, "repodiet-cleanup.patch");

  try {
    await fs.writeFile(patchFile, applyable, "utf8");
    await gitBaseline(rootDir);

    const check = await execa("git", ["apply", "--check", patchFile], {
      cwd: rootDir,
      reject: false,
      timeout: 60_000,
    });

    if (check.exitCode === 0) {
      return { status: "passed" };
    }

    return {
      status: "failed",
      error: (check.stderr || check.stdout || "git apply --check failed.").trim(),
    };
  } catch (err) {
    return {
      status: "failed",
      error: err instanceof Error ? err.message : "Patch validation failed.",
    };
  } finally {
    await removeWorkspace(workspace.root).catch(() => {});
  }
}

export async function validateCleanupPatch(
  repoUrl: string,
  branch: string | undefined,
  patch: string
): Promise<PatchValidationResult> {
  const workspace = await prepareRepoWorkspace(repoUrl, branch);
  try {
    return await validateCleanupPatchInWorkspace(workspace.rootDir, patch);
  } finally {
    await workspace.cleanup();
  }
}
