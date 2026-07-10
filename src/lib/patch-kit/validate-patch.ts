import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execa } from "execa";
import { prepareRepoWorkspace } from "@/lib/scanner/prepare-workspace";

export interface PatchValidationResult {
  status: "passed" | "failed" | "skipped";
  error?: string;
}

const DELETE_MARKERS = [/^git rm /m, /^deleted file mode /m, /^diff --git a\/.+ b\/.+$/m];

export function patchHasDeleteOperations(patch: string): boolean {
  return DELETE_MARKERS.some((pattern) => pattern.test(patch));
}

export async function validateCleanupPatch(
  repoUrl: string,
  branch: string | undefined,
  patch: string
): Promise<PatchValidationResult> {
  if (!patchHasDeleteOperations(patch)) {
    return { status: "skipped", error: "No delete operations in patch." };
  }

  const workspace = await prepareRepoWorkspace(repoUrl, branch);
  const tempDir = path.join(os.tmpdir(), `repodiet-validate-${randomUUID()}`);
  const patchFile = path.join(tempDir, "repodiet-cleanup.patch");

  try {
    await fs.mkdir(tempDir, { recursive: true });
    await fs.writeFile(patchFile, patch, "utf8");

    const gitInit = await execa("git", ["init"], { cwd: workspace.rootDir, reject: false });
    if (gitInit.exitCode !== 0) {
      return { status: "failed", error: gitInit.stderr || "git init failed." };
    }

    await execa("git", ["add", "-A"], { cwd: workspace.rootDir, reject: false });
    await execa(
      "git",
      ["-c", "user.email=repodiet@local", "-c", "user.name=RepoDiet", "commit", "-m", "baseline", "--allow-empty"],
      { cwd: workspace.rootDir, reject: false }
    );

    const check = await execa("git", ["apply", "--check", patchFile], {
      cwd: workspace.rootDir,
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
    await workspace.cleanup();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
