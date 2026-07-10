import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { prepareRepoWorkspace } from "@/lib/scanner/prepare-workspace";
import { createScanWorkspace, removeWorkspace } from "@/lib/server/workspace";

export interface PatchValidationResult {
  status: "passed" | "failed" | "skipped";
  error?: string;
}

const DELETE_MARKERS = [/^deleted file mode /m, /^diff --git a\/.+ b\/.+$/m];

export function patchHasDeleteOperations(patch: string): boolean {
  return DELETE_MARKERS.some((pattern) => pattern.test(patch));
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

export async function validateCleanupPatchInWorkspace(
  rootDir: string,
  patch: string
): Promise<PatchValidationResult> {
  if (!patchHasDeleteOperations(patch)) {
    return { status: "skipped", error: "No delete operations in patch." };
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
