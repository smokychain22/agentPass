import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { prepareRepoWorkspace } from "@/lib/scanner/prepare-workspace";
import { createScanWorkspace, removeWorkspace } from "@/lib/server/workspace";
import { copyRepoBaseline } from "./generate-unified-diff";
import { dedupeConsolidatedEdits, type ConsolidatedEdit } from "./merge-patches";
import {
  validateCanonicalPatch,
  type CanonicalPatchValidationResult,
  type PatchValidationAttempt,
} from "./canonical-patch";

export type PatchValidationResult = CanonicalPatchValidationResult;

export interface ValidateGeneratedPatchOptions {
  cleanupRunId?: string;
  repository?: string;
  baseCommitSha?: string;
  workDir?: string;
  expectedOperations?: import("./canonical-patch").ChangeOperation[];
  protectedPaths?: string[];
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

/** Patch validation only — git apply --check --index --verbose on a clean workspace. Never installs dependencies. */
export async function validateGeneratedPatchOnly(
  baselineRoot: string,
  patch: string,
  options?: ValidateGeneratedPatchOptions
): Promise<PatchValidationResult> {
  if (!patchHasApplyableOperations(patch)) {
    return { status: "not_generated", error: "No patch diff was generated." };
  }

  const workDir =
    options?.workDir ?? path.join(path.dirname(baselineRoot), "patch-validation-work");
  await fs.mkdir(workDir, { recursive: true }).catch(() => {});

  return validateCanonicalPatch({
    baselineRoot,
    patch,
    cleanupRunId: options?.cleanupRunId ?? `validate_${Date.now()}`,
    repository: options?.repository ?? "unknown",
    baseCommitSha: options?.baseCommitSha ?? "workspace-baseline",
    workDir,
    expectedOperations: options?.expectedOperations,
    protectedPaths: options?.protectedPaths,
  });
}

/**
 * @deprecated Patch validation must not install dependencies. Use validateGeneratedPatchOnly
 * for patch validation and runRepositoryVerification for repository checks.
 */
export async function validateEditsForDelivery(
  baselineRoot: string,
  edits: ConsolidatedEdit[],
  patch?: string
): Promise<PatchValidationResult> {
  const deduped = dedupeConsolidatedEdits(edits);
  if (deduped.length === 0) {
    return { status: "skipped", error: "No consolidated edits to validate." };
  }

  if (patch?.trim()) {
    return validateGeneratedPatchOnly(baselineRoot, patch);
  }

  const workspace = await createScanWorkspace("validate-delivery");
  const validateRoot = path.join(workspace.artifactsPath, "root");

  try {
    await copyRepoBaseline(baselineRoot, validateRoot);
    const { buildCanonicalRepositoryPatch } = await import("./canonical-patch");
    const workDir = path.join(workspace.artifactsPath, "work");
    await fs.mkdir(workDir, { recursive: true });
    const consolidated = await buildCanonicalRepositoryPatch(baselineRoot, deduped, workDir);
    if (!consolidated.patch.trim()) {
      return { status: "not_generated", error: "No patch diff was generated." };
    }
    return await validateCanonicalPatch({
      baselineRoot,
      patch: consolidated.patch,
      cleanupRunId: `delivery_${Date.now()}`,
      repository: "unknown",
      baseCommitSha: "workspace-baseline",
      workDir,
      expectedOperations: consolidated.operations,
    });
  } catch (err) {
    return {
      status: "failed",
      error: err instanceof Error ? err.message : "Patch validation failed.",
    };
  } finally {
    await removeWorkspace(workspace.root).catch(() => {});
  }
}

async function applyConsolidatedEdits(
  validateRoot: string,
  edits: ConsolidatedEdit[]
): Promise<void> {
  for (const edit of edits) {
    const full = path.join(validateRoot, edit.path);
    if (edit.content === "") {
      await fs.rm(full, { force: true }).catch(() => {});
      continue;
    }
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, edit.content, "utf8");
  }
}

async function runTypeScriptSyntaxCheck(
  rootDir: string,
  edits: ConsolidatedEdit[],
  options?: { lightweight?: boolean }
): Promise<string | null> {
  const tsFiles = edits
    .filter((e) => /\.(tsx?|jsx?)$/.test(e.path) && e.content !== "")
    .map((e) => e.path);
  if (tsFiles.length === 0) return null;

  if (!options?.lightweight) {
    try {
      const scripts = JSON.parse(
        await fs.readFile(path.join(rootDir, "package.json"), "utf8")
      ) as { scripts?: Record<string, string> };
      if (scripts.scripts?.typecheck || scripts.scripts?.build) {
        return null;
      }
    } catch {
      // fall through to tsc --noEmit when package scripts are unavailable
    }
  }

  const configCandidates = ["tsconfig.json", "tsconfig.app.json"];
  let configPath: string | null = null;
  for (const candidate of configCandidates) {
    try {
      await fs.access(path.join(rootDir, candidate));
      configPath = candidate;
      break;
    } catch {
      /* try next */
    }
  }
  if (!configPath) return null;

  const result = await execa(
    "npx",
    ["--yes", "typescript", "tsc", "-p", configPath, "--noEmit", "--pretty", "false"],
    { cwd: rootDir, reject: false, timeout: 120_000, env: { ...process.env, CI: "true" } }
  );
  if (result.exitCode === 0) return null;
  const snippet = (result.stderr || result.stdout || "").trim().slice(0, 400);
  return snippet
    ? `TypeScript validation failed after applying cleanup edits — ${snippet}`
    : "TypeScript validation failed after applying cleanup edits.";
}

/** @deprecated use runTypeScriptSyntaxCheck */
async function findTypeScriptSyntaxFailure(
  rootDir: string,
  edits: ConsolidatedEdit[]
): Promise<string | null> {
  return runTypeScriptSyntaxCheck(rootDir, edits);
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
    await applyConsolidatedEdits(validateRoot, deduped);
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
  patch: string,
  options?: ValidateGeneratedPatchOptions
): Promise<PatchValidationResult> {
  if (!patchHasApplyableOperations(patch)) {
    return { status: "not_generated", error: "No patch diff was generated." };
  }

  const workDir = options?.workDir ?? path.dirname(rootDir);
  return validateCanonicalPatch({
    baselineRoot: rootDir,
    patch,
    cleanupRunId: options?.cleanupRunId ?? `workspace_${Date.now()}`,
    repository: options?.repository ?? "unknown",
    baseCommitSha: options?.baseCommitSha ?? "workspace-baseline",
    workDir,
    expectedOperations: options?.expectedOperations,
    protectedPaths: options?.protectedPaths,
  });
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

export type { PatchValidationAttempt };
