import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { hashSource } from "@/lib/execution/transform-audit";
import { copyRepoBaseline } from "./generate-unified-diff";
import { dedupeConsolidatedEdits, type ConsolidatedEdit } from "./merge-patches";
import { extractApplyablePatch, patchHasApplyableOperations } from "./validate-patch";
import { buildApplyablePatchFromEdits } from "./applyable-patch-builder";
import { ensureGitRepoInitialized, getGitVersion, isGitCliAvailable } from "./git-runtime";

export type ChangeOperationType = "edit" | "delete" | "add";

export interface ChangeOperation {
  id: string;
  findingIds: string[];
  transformerId: string;
  type: ChangeOperationType;
  filePath: string;
  baseBlobSha: string | null;
  baseContentHash: string | null;
  beforeContent: string | null;
  afterContent: string | null;
  linesAdded: number;
  linesRemoved: number;
}

export interface PatchValidationAttempt {
  cleanupRunId: string;
  repository: string;
  baseCommitSha: string;
  patchHash: string;
  patchByteLength: number;
  patchFileCount: number;
  command: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  failingPath?: string;
  failingHunk?: string;
}

export interface PatchValidationLayer {
  status: "passed" | "failed" | "blocked" | "skipped" | "not_generated" | "pending_worker";
  failureCode?: string;
  error?: string;
}

export interface CanonicalPatchValidationResult {
  status: "passed" | "failed" | "blocked" | "skipped" | "not_generated" | "pending_worker";
  error?: string;
  userMessage?: string;
  baseCommitSha?: string;
  patchHash?: string;
  failingPath?: string;
  failingHunk?: string;
  gitStderr?: string;
  attempt?: PatchValidationAttempt;
  contentIntegrityAttempt?: PatchValidationAttempt;
  validatedPaths?: string[];
  unexpectedPaths?: string[];
  missingPaths?: string[];
  protectedPaths?: string[];
  appliedTreeHash?: string;
  persistedPatchPath?: string;
  patchGenerationMethod?: "git-cli" | "pure-js";
  gitCliAvailable?: boolean;
  contentIntegrityValidation?: PatchValidationLayer;
  gitPatchValidation?: PatchValidationLayer;
}

const PATCH_HEADER = [
  "# RepoDiet cleanup patch",
  "# Canonical repository diff — apply with: git apply --index repodiet-cleanup.patch",
  "",
].join("\n");

export function hashPatchContent(patch: string): string {
  return createHash("sha256").update(patch).digest("hex").slice(0, 16);
}

export function countPatchFileSections(patch: string): number {
  return (extractApplyablePatch(patch).match(/^diff --git /gm) ?? []).length;
}

function countLineDelta(before: string | null, after: string | null): {
  linesAdded: number;
  linesRemoved: number;
} {
  const beforeLines = before ? before.split("\n") : [];
  const afterLines = after ? after.split("\n") : [];
  return {
    linesAdded: Math.max(0, afterLines.length - beforeLines.length),
    linesRemoved: Math.max(0, beforeLines.length - afterLines.length),
  };
}

export function classifyOperationType(
  beforeContent: string | null,
  afterContent: string | null
): ChangeOperationType | null {
  if (beforeContent !== null && afterContent !== null && beforeContent !== afterContent) {
    return "edit";
  }
  if (beforeContent !== null && afterContent === null) return "delete";
  if (beforeContent === null && afterContent !== null) return "add";
  return null;
}

export async function buildChangeOperationsFromEdits(
  baselineRoot: string,
  edits: ConsolidatedEdit[],
  options?: { findingIdsByPath?: Map<string, string[]>; transformerId?: string }
): Promise<ChangeOperation[]> {
  const operations: ChangeOperation[] = [];
  const deduped = dedupeConsolidatedEdits(edits);

  for (const edit of deduped) {
    const rel = edit.path.replace(/\\/g, "/").replace(/^\.\//, "");
    const basePath = path.join(baselineRoot, rel);
    const beforeContent = await fs.readFile(basePath, "utf8").catch(() => null);
    const afterContent = edit.content === "" ? null : edit.content;
    const type = classifyOperationType(beforeContent, afterContent);
    if (!type) continue;

    const { linesAdded, linesRemoved } = countLineDelta(beforeContent, afterContent);
    operations.push({
      id: `op_${createHash("sha256").update(rel).digest("hex").slice(0, 10)}`,
      findingIds: options?.findingIdsByPath?.get(rel) ?? [],
      transformerId: options?.transformerId ?? "consolidated",
      type,
      filePath: rel,
      baseBlobSha: null,
      baseContentHash:
        beforeContent !== null
          ? hashSource(beforeContent)
          : edit.baselineContentHash ?? null,
      beforeContent,
      afterContent,
      linesAdded,
      linesRemoved,
    });
  }

  return operations;
}

async function initGitBaseline(rootDir: string): Promise<string> {
  const ok = await ensureGitRepoInitialized(rootDir);
  if (!ok) return "unknown";
  const rev = await execa("git", ["rev-parse", "HEAD"], { cwd: rootDir, reject: false });
  return (rev.stdout ?? "unknown").trim();
}

export async function applyEditsToWorkspace(rootDir: string, edits: ConsolidatedEdit[]): Promise<string[]> {
  const changedPaths: string[] = [];
  for (const edit of dedupeConsolidatedEdits(edits)) {
    const rel = edit.path.replace(/\\/g, "/").replace(/^\.\//, "");
    const full = path.join(rootDir, rel);
    if (edit.content === "") {
      const existed = await fs.access(full).then(() => true).catch(() => false);
      if (existed) {
        await fs.rm(full, { force: true });
        changedPaths.push(rel);
      }
      continue;
    }
    await fs.mkdir(path.dirname(full), { recursive: true });
    const before = await fs.readFile(full, "utf8").catch(() => null);
    await fs.writeFile(full, edit.content, "utf8");
    const after = await fs.readFile(full, "utf8");
    if (before !== after) changedPaths.push(rel);
  }
  return changedPaths;
}

const GIT_DIFF_CACHED_ARGS = [
  "diff",
  "--cached",
  "--binary",
  "--full-index",
  "--no-ext-diff",
  "--no-renames",
  "--src-prefix=a/",
  "--dst-prefix=b/",
  "HEAD",
] as const;

async function buildPatchViaGitCli(
  baselineRoot: string,
  edits: ConsolidatedEdit[],
  workDir: string
): Promise<{ patch: string; changedPaths: string[] } | null> {
  const deduped = dedupeConsolidatedEdits(edits);
  const scratchRoot = path.join(workDir, `canonical-git-${Date.now()}`);
  await copyRepoBaseline(baselineRoot, scratchRoot);

  const initialized = await ensureGitRepoInitialized(scratchRoot);
  if (!initialized) {
    await fs.rm(scratchRoot, { recursive: true, force: true }).catch(() => {});
    return null;
  }

  const changedPaths = await applyEditsToWorkspace(scratchRoot, deduped);
  if (changedPaths.length === 0) {
    await fs.rm(scratchRoot, { recursive: true, force: true }).catch(() => {});
    return null;
  }

  await execa("git", ["add", "-A"], { cwd: scratchRoot, reject: false, timeout: 60_000 });
  const diff = await execa("git", [...GIT_DIFF_CACHED_ARGS], {
    cwd: scratchRoot,
    reject: false,
    timeout: 60_000,
  });

  await fs.rm(scratchRoot, { recursive: true, force: true }).catch(() => {});

  const rawPatch = (diff.stdout ?? "").trim();
  if (!rawPatch || !rawPatch.includes("diff --git")) {
    return null;
  }

  return { patch: `${PATCH_HEADER}${rawPatch}\n`, changedPaths };
}

async function applyOperationsToRoot(
  rootDir: string,
  operations: ChangeOperation[]
): Promise<string[]> {
  const changedPaths: string[] = [];
  for (const op of operations) {
    const full = path.join(rootDir, op.filePath);
    if (op.type === "delete") {
      const existed = await fs.access(full).then(() => true).catch(() => false);
      if (existed) {
        await fs.rm(full, { force: true });
        changedPaths.push(op.filePath);
      }
      continue;
    }
    if (op.afterContent === null) continue;
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, op.afterContent, "utf8");
    changedPaths.push(op.filePath);
  }
  return changedPaths;
}

async function validateOperationsDirectly(input: {
  baselineRoot: string;
  operations: ChangeOperation[];
  protectedPaths?: string[];
  cleanupRunId: string;
  repository: string;
  baseCommitSha: string;
  patch: string;
  workDir: string;
}): Promise<CanonicalPatchValidationResult> {
  const applyable = extractApplyablePatch(input.patch);
  const patchHash = hashPatchContent(applyable);
  const patchByteLength = Buffer.byteLength(applyable, "utf8");
  const patchFileCount = countPatchFileSections(applyable);
  const patchDir = path.join(input.workDir, "patches");
  const persistedPatchPath = path.join(patchDir, `${input.cleanupRunId}.patch`);
  const validateRoot = path.join(input.workDir, `validate-direct-${Date.now()}`);

  try {
    await fs.mkdir(patchDir, { recursive: true });
    await fs.writeFile(persistedPatchPath, applyable, "utf8");
    await copyRepoBaseline(input.baselineRoot, validateRoot);
    const appliedPaths = await applyOperationsToRoot(validateRoot, input.operations);

    const validatedPaths: string[] = [];
    for (const op of input.operations) {
      const full = path.join(validateRoot, op.filePath);
      if (op.type === "delete") {
        const missing = await fs.access(full).then(() => false).catch(() => true);
        if (!missing) {
          return {
            status: "failed",
            error: `Expected delete did not remove path: ${op.filePath}`,
            baseCommitSha: input.baseCommitSha,
            patchHash,
            failingPath: op.filePath,
            persistedPatchPath,
            patchGenerationMethod: "pure-js",
            gitCliAvailable: false,
          };
        }
        validatedPaths.push(op.filePath);
        continue;
      }
      const actual = await fs.readFile(full, "utf8").catch(() => null);
      if (actual !== op.afterContent) {
        return {
          status: "failed",
          error: `Applied content mismatch for ${op.filePath}`,
          baseCommitSha: input.baseCommitSha,
          patchHash,
          failingPath: op.filePath,
          persistedPatchPath,
          patchGenerationMethod: "pure-js",
          gitCliAvailable: false,
        };
      }
      validatedPaths.push(op.filePath);
    }

    const expectedPaths = input.operations.map((op) => op.filePath);
    const protectedSet = new Set(input.protectedPaths ?? []);
    const protectedPaths = validatedPaths.filter((p) => protectedSet.has(p));
    const unexpectedPaths = appliedPaths.filter((p) => !expectedPaths.includes(p));
    const missingPaths = expectedPaths.filter((p) => !validatedPaths.includes(p));

    if (protectedPaths.length > 0 || missingPaths.length > 0 || unexpectedPaths.length > 0) {
      return {
        status: "failed",
        error: protectedPaths.length
          ? `Protected path(s) modified: ${protectedPaths.join(", ")}`
          : missingPaths.length
            ? `Expected path(s) missing: ${missingPaths.join(", ")}`
            : `Unexpected path(s): ${unexpectedPaths.join(", ")}`,
        baseCommitSha: input.baseCommitSha,
        patchHash,
        validatedPaths,
        unexpectedPaths,
        missingPaths,
        protectedPaths,
        persistedPatchPath,
        patchGenerationMethod: "pure-js",
        gitCliAvailable: false,
      };
    }

    const t0 = Date.now();
    const contentAttempt: PatchValidationAttempt = {
      cleanupRunId: input.cleanupRunId,
      repository: input.repository,
      baseCommitSha: input.baseCommitSha,
      patchHash,
      patchByteLength,
      patchFileCount,
      command: ["content-integrity", "apply-change-operations"],
      exitCode: 0,
      stdout: `Validated ${validatedPaths.length} path(s) via direct content apply.`,
      stderr: "",
      durationMs: Date.now() - t0,
    };

    return {
      status: "blocked",
      error: "Git CLI is unavailable; content integrity passed but git apply --check did not run.",
      baseCommitSha: input.baseCommitSha,
      patchHash,
      validatedPaths,
      unexpectedPaths: [],
      missingPaths: [],
      protectedPaths: [],
      contentIntegrityAttempt: contentAttempt,
      attempt: contentAttempt,
      persistedPatchPath,
      patchGenerationMethod: "pure-js",
      gitCliAvailable: false,
      contentIntegrityValidation: { status: "passed" },
      gitPatchValidation: {
        status: "blocked",
        failureCode: "GIT_CLI_UNAVAILABLE",
        error: "Git CLI unavailable in this runtime.",
      },
    };
  } catch (err) {
    return {
      status: "failed",
      error: err instanceof Error ? err.message : "Direct patch validation failed.",
      baseCommitSha: input.baseCommitSha,
      patchHash,
      persistedPatchPath,
      patchGenerationMethod: "pure-js",
      gitCliAvailable: false,
    };
  } finally {
    await fs.rm(validateRoot, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Build one canonical repository diff from baseline + final file contents.
 * Uses git CLI when available; falls back to pure-JS patch builder on serverless hosts.
 */
export async function buildCanonicalRepositoryPatch(
  baselineRoot: string,
  edits: ConsolidatedEdit[],
  workDir: string
): Promise<{
  patch: string;
  changedPaths: string[];
  operations: ChangeOperation[];
  method: "git-cli" | "pure-js";
  gitCliAvailable: boolean;
}> {
  const deduped = dedupeConsolidatedEdits(edits);
  const operations = await buildChangeOperationsFromEdits(baselineRoot, deduped);
  if (deduped.length === 0 || operations.length === 0) {
    return { patch: "", changedPaths: [], operations: [], method: "pure-js", gitCliAvailable: false };
  }

  const gitCliAvailable = await isGitCliAvailable();

  if (gitCliAvailable) {
    const gitPatch = await buildPatchViaGitCli(baselineRoot, deduped, workDir);
    if (gitPatch && patchHasApplyableOperations(gitPatch.patch)) {
      return { ...gitPatch, operations, method: "git-cli", gitCliAvailable: true };
    }
  }

  const pure = await buildApplyablePatchFromEdits(baselineRoot, deduped);
  if (patchHasApplyableOperations(pure.patch)) {
    return {
      patch: pure.patch,
      changedPaths: pure.changedPaths,
      operations,
      method: "pure-js",
      gitCliAvailable,
    };
  }

  return { patch: "", changedPaths: [], operations, method: "pure-js", gitCliAvailable };
}

export function parseGitApplyError(stderr: string): {
  failingPath?: string;
  failingHunk?: string;
  message: string;
} {
  const lines = stderr.split("\n").map((l) => l.trim()).filter(Boolean);
  const patchFailed = lines.find((l) => l.startsWith("error: patch failed:"));
  const doesNotExist = lines.find((l) => l.includes(": does not exist in index"));
  const patchDoesNotApply = lines.find((l) => l.includes(": patch does not apply"));

  if (patchFailed) {
    const match = patchFailed.match(/^error: patch failed: ([^:]+):(\d+)?/);
    return {
      failingPath: match?.[1],
      failingHunk: match?.[2],
      message: patchFailed,
    };
  }
  if (doesNotExist) {
    const match = doesNotExist.match(/^error: ([^:]+): does not exist in index/);
    return {
      failingPath: match?.[1],
      message: doesNotExist,
    };
  }
  if (patchDoesNotApply) {
    const match = patchDoesNotApply.match(/^error: ([^:]+): patch does not apply/);
    return {
      failingPath: match?.[1],
      message: patchDoesNotApply,
    };
  }

  return { message: lines.join("\n") || "git apply --check failed." };
}

export function formatPatchValidationUserMessage(input: {
  gitStderr: string;
  baseCommitSha: string;
  failingPath?: string;
}): string {
  const parsed = parseGitApplyError(input.gitStderr);
  const affected = input.failingPath ?? parsed.failingPath;
  const lines = ["Patch could not be applied to the scanned commit."];
  if (affected) lines.push("", `Affected path:\n${affected}`);
  lines.push("", `Git error:\n${parsed.message || input.gitStderr.trim()}`);
  lines.push("", `Base commit:\n${input.baseCommitSha}`);
  return lines.join("\n");
}

async function readHeadSha(rootDir: string): Promise<string> {
  const result = await execa("git", ["rev-parse", "HEAD"], { cwd: rootDir, reject: false });
  return (result.stdout ?? "").trim();
}

async function isGitClean(rootDir: string): Promise<boolean> {
  const result = await execa("git", ["status", "--porcelain"], { cwd: rootDir, reject: false });
  return (result.stdout ?? "").trim() === "";
}

export interface ValidateCanonicalPatchInput {
  baselineRoot: string;
  patch: string;
  expectedOperations?: ChangeOperation[];
  protectedPaths?: string[];
  cleanupRunId: string;
  repository: string;
  baseCommitSha: string;
  workDir: string;
}

/**
 * Validate patch in a fresh workspace B — never the transformation workspace.
 */
export async function validateCanonicalPatch(
  input: ValidateCanonicalPatchInput
): Promise<CanonicalPatchValidationResult> {
  const applyable = extractApplyablePatch(input.patch);
  if (!applyable.trim() || !/^diff --git /m.test(applyable)) {
    return { status: "not_generated", error: "No patch diff was generated." };
  }

  const gitCliAvailable = await isGitCliAvailable();
  if (
    !gitCliAvailable &&
    input.expectedOperations &&
    input.expectedOperations.length > 0
  ) {
    const direct = await validateOperationsDirectly({
      baselineRoot: input.baselineRoot,
      operations: input.expectedOperations,
      protectedPaths: input.protectedPaths,
      cleanupRunId: input.cleanupRunId,
      repository: input.repository,
      baseCommitSha: input.baseCommitSha,
      patch: input.patch,
      workDir: input.workDir,
    });
    return direct;
  }

  const patchHash = hashPatchContent(applyable);
  const patchByteLength = Buffer.byteLength(applyable, "utf8");
  const patchFileCount = countPatchFileSections(applyable);
  const command = ["git", "apply", "--check", "--index", "--verbose", "cleanup.patch"];

  const validateRoot = path.join(input.workDir, `validate-${Date.now()}`);
  const patchDir = path.join(input.workDir, "patches");
  const persistedPatchPath = path.join(patchDir, `${input.cleanupRunId}.patch`);

  try {
    await fs.mkdir(patchDir, { recursive: true });
    await fs.writeFile(persistedPatchPath, applyable, "utf8");

    await copyRepoBaseline(input.baselineRoot, validateRoot);
    const initialized = await ensureGitRepoInitialized(validateRoot);
    if (!initialized) {
      if (input.expectedOperations?.length) {
        return validateOperationsDirectly({
          baselineRoot: input.baselineRoot,
          operations: input.expectedOperations,
          protectedPaths: input.protectedPaths,
          cleanupRunId: input.cleanupRunId,
          repository: input.repository,
          baseCommitSha: input.baseCommitSha,
          patch: input.patch,
          workDir: input.workDir,
        });
      }
      return {
        status: "failed",
        error: "Git repository initialization failed in validation workspace.",
        baseCommitSha: input.baseCommitSha,
        patchHash,
        persistedPatchPath,
        gitCliAvailable,
      };
    }

    const headSha = await readHeadSha(validateRoot);
    const clean = await isGitClean(validateRoot);
    if (!clean) {
      return {
        status: "failed",
        error: "Validation workspace is not clean before patch apply.",
        baseCommitSha: input.baseCommitSha,
        patchHash,
        persistedPatchPath,
      };
    }

    const patchFile = path.join(validateRoot, "cleanup.patch");
    await fs.writeFile(patchFile, applyable, "utf8");

    const t0 = Date.now();
    const check = await execa("git", ["apply", "--check", "--index", "--verbose", patchFile], {
      cwd: validateRoot,
      reject: false,
      timeout: 60_000,
    });
    const durationMs = Date.now() - t0;
    const stderr = (check.stderr ?? "").trim();
    const stdout = (check.stdout ?? "").trim();
    const parsed = parseGitApplyError(stderr || stdout);

    const attempt: PatchValidationAttempt = {
      cleanupRunId: input.cleanupRunId,
      repository: input.repository,
      baseCommitSha: input.baseCommitSha,
      patchHash,
      patchByteLength,
      patchFileCount,
      command,
      exitCode: check.exitCode ?? 1,
      stdout,
      stderr,
      durationMs,
      failingPath: parsed.failingPath,
      failingHunk: parsed.failingHunk,
    };

    if (check.exitCode !== 0) {
      return {
        status: "failed",
        error: parsed.message || "git apply --check failed.",
        userMessage: formatPatchValidationUserMessage({
          gitStderr: stderr || stdout,
          baseCommitSha: input.baseCommitSha,
          failingPath: parsed.failingPath,
        }),
        baseCommitSha: input.baseCommitSha,
        patchHash,
        failingPath: parsed.failingPath,
        failingHunk: parsed.failingHunk,
        gitStderr: stderr || stdout,
        attempt,
        persistedPatchPath,
        gitCliAvailable,
        gitPatchValidation: {
          status: "failed",
          failureCode: "GIT_PATCH_INVALID",
          error: parsed.message || "git apply --check failed.",
        },
      };
    }

    const apply = await execa("git", ["apply", "--index", patchFile], {
      cwd: validateRoot,
      reject: false,
      timeout: 60_000,
    });
    if (apply.exitCode !== 0) {
      const applyErr = (apply.stderr ?? apply.stdout ?? "").trim();
      const applyParsed = parseGitApplyError(applyErr);
      return {
        status: "failed",
        error: applyParsed.message || "git apply failed.",
        userMessage: formatPatchValidationUserMessage({
          gitStderr: applyErr,
          baseCommitSha: input.baseCommitSha,
          failingPath: applyParsed.failingPath,
        }),
        baseCommitSha: input.baseCommitSha,
        patchHash,
        failingPath: applyParsed.failingPath,
        gitStderr: applyErr,
        attempt: { ...attempt, exitCode: apply.exitCode ?? 1, stderr: applyErr, command: ["git", "apply", "--index", "cleanup.patch"] },
        persistedPatchPath,
      };
    }

    const whitespace = await execa("git", ["diff", "--cached", "--check"], {
      cwd: validateRoot,
      reject: false,
    });
    if (whitespace.exitCode !== 0) {
      return {
        status: "failed",
        error: (whitespace.stderr ?? "Whitespace error in staged patch.").trim(),
        baseCommitSha: input.baseCommitSha,
        patchHash,
        gitStderr: whitespace.stderr ?? "",
        attempt,
        persistedPatchPath,
      };
    }

    const staged = await execa("git", ["diff", "--cached", "--name-only"], {
      cwd: validateRoot,
      reject: false,
    });
    const validatedPaths = (staged.stdout ?? "")
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);

    const expectedPaths = (input.expectedOperations ?? []).map((op) => op.filePath);
    const protectedSet = new Set(input.protectedPaths ?? []);
    const protectedPaths = validatedPaths.filter((p) => protectedSet.has(p));
    const unexpectedPaths = validatedPaths.filter((p) => !expectedPaths.includes(p));
    const missingPaths = expectedPaths.filter((p) => !validatedPaths.includes(p));

    if (protectedPaths.length > 0) {
      return {
        status: "failed",
        error: `Protected path(s) modified: ${protectedPaths.join(", ")}`,
        baseCommitSha: input.baseCommitSha,
        patchHash,
        validatedPaths,
        unexpectedPaths,
        missingPaths,
        protectedPaths,
        attempt,
        persistedPatchPath,
      };
    }

    if (input.expectedOperations?.length) {
      if (missingPaths.length > 0) {
        return {
          status: "failed",
          error: `Expected path(s) missing from staged patch: ${missingPaths.join(", ")}`,
          baseCommitSha: input.baseCommitSha,
          patchHash,
          validatedPaths,
          unexpectedPaths,
          missingPaths,
          protectedPaths,
          attempt,
          persistedPatchPath,
        };
      }
      if (unexpectedPaths.length > 0) {
        return {
          status: "failed",
          error: `Unexpected path(s) in staged patch: ${unexpectedPaths.join(", ")}`,
          baseCommitSha: input.baseCommitSha,
          patchHash,
          validatedPaths,
          unexpectedPaths,
          missingPaths,
          protectedPaths,
          attempt,
          persistedPatchPath,
        };
      }
    }

    const tree = await execa("git", ["write-tree"], { cwd: validateRoot, reject: false });
    return {
      status: "passed",
      baseCommitSha: input.baseCommitSha,
      patchHash,
      validatedPaths,
      unexpectedPaths: [],
      missingPaths: [],
      protectedPaths: [],
      appliedTreeHash: (tree.stdout ?? "").trim(),
      attempt: { ...attempt, exitCode: 0 },
      persistedPatchPath,
      patchGenerationMethod: "git-cli",
      gitCliAvailable: true,
      gitPatchValidation: { status: "passed" },
      contentIntegrityValidation: { status: "skipped" },
    };
  } catch (err) {
    return {
      status: "failed",
      error: err instanceof Error ? err.message : "Patch validation failed.",
      baseCommitSha: input.baseCommitSha,
      patchHash,
      persistedPatchPath,
    };
  } finally {
    await fs.rm(validateRoot, { recursive: true, force: true }).catch(() => {});
  }
}

export interface BaseCommitStaleResult {
  stale: boolean;
  failureCode?: "BASE_COMMIT_STALE";
  scanCommitSha?: string;
  currentCommitSha?: string;
}

export function assertBaseCommitFresh(
  scanCommitSha: string | undefined,
  currentCommitSha: string | undefined
): BaseCommitStaleResult {
  if (!scanCommitSha || !currentCommitSha) {
    return { stale: false, scanCommitSha, currentCommitSha };
  }
  if (scanCommitSha !== currentCommitSha) {
    return {
      stale: true,
      failureCode: "BASE_COMMIT_STALE",
      scanCommitSha,
      currentCommitSha,
    };
  }
  return { stale: false, scanCommitSha, currentCommitSha };
}
