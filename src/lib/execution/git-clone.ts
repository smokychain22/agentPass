import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";

export async function getGitVersion(): Promise<string> {
  const result = await execa("git", ["--version"], { reject: false });
  return (result.stdout ?? "unknown").trim();
}

export async function cloneExactCommit(input: {
  repoUrl: string;
  baseCommitSha: string;
  token?: string;
  workDir: string;
}): Promise<{ rootDir: string; headSha: string }> {
  const rootDir = path.join(input.workDir, "repository");
  await fs.rm(rootDir, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(rootDir, { recursive: true });

  const authUrl = input.token
    ? input.repoUrl.replace("https://", `https://x-access-token:${input.token}@`)
    : input.repoUrl;

  await execa("git", ["init"], { cwd: rootDir });
  await execa("git", ["remote", "add", "origin", authUrl], { cwd: rootDir });
  await execa("git", ["fetch", "--depth", "1", "origin", input.baseCommitSha], {
    cwd: rootDir,
    timeout: 120_000,
  });
  await execa("git", ["checkout", "--detach", "FETCH_HEAD"], { cwd: rootDir });

  const head = await execa("git", ["rev-parse", "HEAD"], { cwd: rootDir, reject: false });
  const headSha = (head.stdout ?? "").trim();
  if (headSha !== input.baseCommitSha) {
    throw new Error(`BASE_COMMIT_MISMATCH: expected ${input.baseCommitSha}, got ${headSha}`);
  }

  const status = await execa("git", ["status", "--porcelain"], { cwd: rootDir, reject: false });
  if ((status.stdout ?? "").trim()) {
    throw new Error("DIRTY_BASELINE_WORKSPACE");
  }

  return { rootDir, headSha };
}

export async function generateGitPatch(
  rootDir: string,
  edits: Array<{ path: string; content: string }>
): Promise<{ patch: string; changedPaths: string[] }> {
  const { applyEditsToWorkspace } = await import("@/lib/patch-kit/canonical-patch");
  const changedPaths = await applyEditsToWorkspace(rootDir, edits);
  await execa("git", ["add", "-A"], { cwd: rootDir, reject: false });
  const diff = await execa(
    "git",
    [
      "diff",
      "--cached",
      "--binary",
      "--full-index",
      "--no-ext-diff",
      "--no-renames",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      "HEAD",
    ],
    { cwd: rootDir, reject: false }
  );
  const patch = (diff.stdout ?? "").trim();
  if (!patch.includes("diff --git")) {
    throw new Error("Git patch generation produced no diff.");
  }
  return { patch: `${patch}\n`, changedPaths };
}

export async function validateGitPatch(
  baselineRoot: string,
  patch: string,
  expectedPaths: string[]
): Promise<{
  status: "passed" | "failed";
  command: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  validatedPaths: string[];
  missingPaths: string[];
  unexpectedPaths: string[];
}> {
  const validationRoot = path.join(path.dirname(baselineRoot), "validation");
  await fs.cp(baselineRoot, validationRoot, { recursive: true, force: true });

  const patchFile = path.join(validationRoot, "cleanup.patch");
  await fs.writeFile(patchFile, patch, "utf8");

  const command = ["git", "apply", "--check", "--index", "--verbose", "cleanup.patch"];
  const check = await execa("git", ["apply", "--check", "--index", "--verbose", patchFile], {
    cwd: validationRoot,
    reject: false,
    timeout: 60_000,
  });

  if (check.exitCode !== 0) {
    return {
      status: "failed",
      command,
      exitCode: check.exitCode ?? 1,
      stdout: check.stdout ?? "",
      stderr: check.stderr ?? "",
      validatedPaths: [],
      missingPaths: expectedPaths,
      unexpectedPaths: [],
    };
  }

  await execa("git", ["apply", "--index", patchFile], { cwd: validationRoot, reject: false });
  const staged = await execa("git", ["diff", "--cached", "--name-only"], {
    cwd: validationRoot,
    reject: false,
  });
  const validatedPaths = (staged.stdout ?? "")
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean);
  const missingPaths = expectedPaths.filter((p) => !validatedPaths.includes(p));
  const unexpectedPaths = validatedPaths.filter((p) => !expectedPaths.includes(p));

  return {
    status: missingPaths.length === 0 && unexpectedPaths.length === 0 ? "passed" : "failed",
    command,
    exitCode: 0,
    stdout: check.stdout ?? "",
    stderr: check.stderr ?? "",
    validatedPaths,
    missingPaths,
    unexpectedPaths,
  };
}
