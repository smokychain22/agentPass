import path from "node:path";
import type { Sandbox } from "@vercel/sandbox";
import { isServerlessRuntime } from "@/lib/server/runtime-env";
import { runRepositoryVerification } from "@/lib/patch-kit/repository-verification";
import type { RepositoryVerificationResult } from "@/lib/patch-kit/repository-verification";
import type { CanonicalPatchValidationResult } from "@/lib/patch-kit/canonical-patch";
import { hashPatchContent } from "@/lib/patch-kit/canonical-patch";
import { cloneExactCommit, generateGitPatch, getGitVersion, validateGitPatch } from "./git-clone";
import {
  authenticatedCloneUrl,
  createFreshGitHubInstallationToken,
} from "./sandbox-github-token";
import { runSandboxCommand, runSandboxShell } from "./sandbox-command";
import {
  createCleanupSandbox,
  isVercelSandboxAvailable,
  sandboxWorkspaceRoot,
  stopCleanupSandbox,
} from "./vercel-sandbox";
import type { SandboxRunPayload } from "./sandbox-run-types";
import { updateSandboxRun } from "./sandbox-run-store";

export interface RepositoryExecutionResult {
  patchValidation: CanonicalPatchValidationResult;
  repositoryVerification: RepositoryVerificationResult;
  gitVersion?: string;
  nodeVersion?: string;
  npmVersion?: string;
  patchHash?: string;
  sandboxId?: string;
  logs: string[];
}

async function ensureGitInSandbox(sandbox: Sandbox): Promise<string> {
  const version = await runSandboxShell(sandbox, "git --version || (sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git) && git --version");
  return version.stdout.trim().split("\n").pop() ?? "unknown";
}

async function cloneInSandbox(
  sandbox: Sandbox,
  root: string,
  repoUrl: string,
  baseCommitSha: string,
  token: string
): Promise<void> {
  const authUrl = authenticatedCloneUrl(repoUrl, token);
  await runSandboxShell(
    sandbox,
    `rm -rf "${root}" && mkdir -p "${root}" && cd "${root}" && git init && git remote add origin "${authUrl.replace(/"/g, '\\"')}" && git fetch --depth 1 origin ${baseCommitSha} && git checkout --detach FETCH_HEAD && test "$(git rev-parse HEAD)" = "${baseCommitSha}" && test -z "$(git status --porcelain)"`,
    { secrets: [token] }
  );
}

async function applyEditsInSandbox(
  sandbox: Sandbox,
  root: string,
  edits: Array<{ path: string; content: string }>
): Promise<string[]> {
  const changed: string[] = [];
  for (const edit of edits) {
    const rel = edit.path.replace(/\\/g, "/").replace(/^\.\//, "");
    const full = `${root}/${rel}`;
    if (edit.content === "") {
      await runSandboxShell(sandbox, `rm -f "${full}"`);
      changed.push(rel);
      continue;
    }
    await runSandboxShell(sandbox, `mkdir -p "$(dirname "${full}")"`);
    await sandbox.fs.writeFile(full, edit.content);
    changed.push(rel);
  }
  return changed;
}

async function runVerificationScriptsInSandbox(
  sandbox: Sandbox,
  root: string
): Promise<{ installExit: number; checks: Array<{ name: string; exitCode: number; stderr: string }> }> {
  const install = await runSandboxShell(
    sandbox,
    `cd "${root}" && if [ -f package-lock.json ]; then npm ci --include=dev --include=optional --no-audit --no-fund; else npm install --include=dev --include=optional --no-audit --no-fund; fi`,
    { cwd: root }
  );

  const checks: Array<{ name: string; exitCode: number; stderr: string }> = [];
  for (const script of ["typecheck", "lint", "test", "build"] as const) {
    const probe = await runSandboxShell(
      sandbox,
      `cd "${root}" && node -e "const p=require('./package.json'); process.exit(p.scripts&&p.scripts['${script}']?0:2)"`,
      { cwd: root }
    );
    if (probe.exitCode !== 0) continue;
    const run = await runSandboxShell(sandbox, `cd "${root}" && npm run ${script}`, { cwd: root });
    checks.push({ name: script, exitCode: run.exitCode, stderr: run.stderr });
  }

  return { installExit: install.exitCode, checks };
}

function verificationFromSandboxChecks(input: {
  installExit: number;
  checks: Array<{ name: string; exitCode: number; stderr: string }>;
  phase: "baseline" | "patched";
}): RepositoryVerificationResult {
  if (input.installExit !== 0) {
    return {
      status: "blocked",
      outcome: input.phase === "baseline" ? "baseline_blocked" : "blocked",
      failureCode: "DEPENDENCY_INSTALL_FAILED",
      error: `${input.phase} dependency installation failed in sandbox.`,
      installAttempts: [],
      checks: [],
    };
  }

  const failed = input.checks.find((c) => c.exitCode !== 0);
  if (failed) {
    return {
      status: input.phase === "baseline" ? "baseline_blocked" : "failed",
      outcome: input.phase === "baseline" ? "baseline_blocked" : "regression_failed",
      failureCode: "CHECK_FAILED",
      error: `${input.phase} ${failed.name} failed in sandbox.`,
      installAttempts: [],
      checks: input.checks.map((c) => ({
        name: c.name,
        command: `npm run ${c.name}`,
        status: c.exitCode === 0 ? "passed" : "failed",
        exitCode: c.exitCode,
        durationMs: 0,
        stdoutSummary: "",
        stderrSummary: c.stderr.slice(0, 400),
      })),
    };
  }

  return {
    status: input.phase === "patched" ? "verified" : "not_run",
    outcome: input.phase === "patched" ? "verified" : undefined,
    installAttempts: [],
    checks: input.checks.map((c) => ({
      name: c.name,
      command: `npm run ${c.name}`,
      status: "passed",
      exitCode: 0,
      durationMs: 0,
      stdoutSummary: "passed",
      stderrSummary: "",
    })),
  };
}

export async function executeRepositoryCleanupInSandbox(
  runId: string,
  payload: SandboxRunPayload
): Promise<RepositoryExecutionResult> {
  const logs: string[] = [];
  const log = (line: string) => {
    logs.push(line);
  };

  let sandbox: Sandbox | undefined;
  let token = "";

  try {
    await updateSandboxRun(runId, { status: "creating_sandbox", progress: "Preparing isolated sandbox" });

    const github = await createFreshGitHubInstallationToken({
      repositoryOwner: payload.repositoryOwner,
      repositoryName: payload.repositoryName,
      installationId: payload.installationId,
      jobId: runId,
    });
    token = github.token;

    sandbox = await createCleanupSandbox({
      cleanupRunId: payload.cleanupRunId,
      repositoryId: `${payload.repositoryOwner}/${payload.repositoryName}`,
      baseCommitSha: payload.baseCommitSha,
    });

    const workspace = sandboxWorkspaceRoot(payload.cleanupRunId);
    const baseline = `${workspace}/baseline`;
    const transformed = `${workspace}/transformed`;
    const validation = `${workspace}/validation`;

    await updateSandboxRun(runId, { status: "cloning", progress: "Fetching exact commit", sandboxId: sandbox.name });

    const gitVersion = await ensureGitInSandbox(sandbox);
    log(`git: ${gitVersion}`);

    await runSandboxShell(sandbox, `mkdir -p "${workspace}"`);
    await cloneInSandbox(sandbox, baseline, payload.repoUrl, payload.baseCommitSha, token);
    await runSandboxShell(sandbox, `cp -a "${baseline}/." "${transformed}" && cp -a "${baseline}/." "${validation}"`);

    await updateSandboxRun(runId, { status: "baseline_verification", progress: "Verifying repository baseline" });
    const baselineResult = await runVerificationScriptsInSandbox(sandbox, baseline);
    const baselineVerification = verificationFromSandboxChecks({
      ...baselineResult,
      phase: "baseline",
    });

    if (baselineVerification.status === "blocked" || baselineVerification.status === "baseline_blocked") {
      return {
        patchValidation: {
          status: "failed",
          error: baselineVerification.error,
          gitCliAvailable: true,
        },
        repositoryVerification: baselineVerification,
        gitVersion,
        sandboxId: sandbox.name,
        logs,
      };
    }

    await updateSandboxRun(runId, { status: "applying_operations", progress: "Applying cleanup operations" });
    await applyEditsInSandbox(sandbox, transformed, payload.edits);

    await updateSandboxRun(runId, { status: "generating_patch", progress: "Generating Git patch" });
    const patchGen = await runSandboxShell(
      sandbox,
      `cd "${transformed}" && git add -A && git diff --cached --binary --full-index --no-ext-diff --no-renames --src-prefix=a/ --dst-prefix=b/ HEAD`,
      { cwd: transformed }
    );
    const patch = patchGen.stdout.trim() ? `${patchGen.stdout.trim()}\n` : "";
    if (!patch.includes("diff --git")) {
      throw new Error("PATCH_GENERATION_FAILED");
    }
    const patchHash = hashPatchContent(patch);

    await updateSandboxRun(runId, { status: "git_validation", progress: "Running git apply --check" });
    await sandbox.fs.writeFile(`${validation}/cleanup.patch`, patch);
    const expectedPaths = payload.changeOperations.map((op) => op.filePath);
    const check = await runSandboxShell(
      sandbox,
      `cd "${validation}" && git apply --check --index --verbose cleanup.patch && git apply --index cleanup.patch && git diff --cached --check`,
      { cwd: validation }
    );

    const staged = await runSandboxShell(sandbox, `cd "${validation}" && git diff --cached --name-only`, {
      cwd: validation,
    });
    const validatedPaths = staged.stdout
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);
    const missingPaths = expectedPaths.filter((p) => !validatedPaths.includes(p));
    const unexpectedPaths = validatedPaths.filter((p) => !expectedPaths.includes(p));

    const patchValidation: CanonicalPatchValidationResult =
      check.exitCode === 0 && missingPaths.length === 0 && unexpectedPaths.length === 0
        ? {
            status: "passed",
            gitCliAvailable: true,
            patchGenerationMethod: "git-cli",
            patchHash,
            validatedPaths,
            gitPatchValidation: { status: "passed" },
            contentIntegrityValidation: { status: "passed" },
            attempt: {
              cleanupRunId: payload.cleanupRunId,
              repository: `${payload.repositoryOwner}/${payload.repositoryName}`,
              baseCommitSha: payload.baseCommitSha,
              patchHash,
              patchByteLength: Buffer.byteLength(patch, "utf8"),
              patchFileCount: expectedPaths.length,
              command: ["git", "apply", "--check", "--index", "--verbose", "cleanup.patch"],
              exitCode: check.exitCode,
              stdout: check.stdout,
              stderr: check.stderr,
              durationMs: check.durationMs,
            },
          }
        : {
            status: "failed",
            error: check.stderr || "git apply --check failed",
            gitCliAvailable: true,
            patchHash,
            gitPatchValidation: { status: "failed", failureCode: "GIT_PATCH_INVALID" },
            contentIntegrityValidation: { status: "passed" },
          };

    if (patchValidation.status !== "passed") {
      return {
        patchValidation,
        repositoryVerification: { status: "not_run", installAttempts: [], checks: [] },
        gitVersion,
        patchHash,
        sandboxId: sandbox.name,
        logs,
      };
    }

    await updateSandboxRun(runId, { status: "patched_verification", progress: "Running patched verification" });
    const patchedResult = await runVerificationScriptsInSandbox(sandbox, validation);
    const patchedVerification = verificationFromSandboxChecks({
      ...patchedResult,
      phase: "patched",
    });

    const nodeVersion = (await runSandboxShell(sandbox, "node --version")).stdout.trim();
    const npmVersion = (await runSandboxShell(sandbox, "npm --version")).stdout.trim();

    return {
      patchValidation,
      repositoryVerification: {
        ...patchedVerification,
        baseline: {
          phase: "baseline",
          installAttempts: [],
          checks: baselineVerification.checks ?? [],
        },
        patched: {
          phase: "patched",
          installAttempts: [],
          checks: patchedVerification.checks ?? [],
        },
      },
      gitVersion,
      nodeVersion,
      npmVersion,
      patchHash,
      sandboxId: sandbox.name,
      logs,
    };
  } finally {
    token = "";
    await stopCleanupSandbox(sandbox);
  }
}

export async function executeRepositoryCleanupLocal(
  payload: SandboxRunPayload
): Promise<RepositoryExecutionResult> {
  const workRoot = path.join("/tmp", "repodiet", payload.cleanupRunId);
  const github = await createFreshGitHubInstallationToken({
    repositoryOwner: payload.repositoryOwner,
    repositoryName: payload.repositoryName,
    installationId: payload.installationId,
  });

  const { rootDir: baselineRoot } = await cloneExactCommit({
    repoUrl: payload.repoUrl,
    baseCommitSha: payload.baseCommitSha,
    token: github.token,
    workDir: workRoot,
  });

  const { patch } = await generateGitPatch(baselineRoot, payload.edits);
  const expectedPaths = payload.changeOperations.map((op) => op.filePath);
  const gitValidation = await validateGitPatch(baselineRoot, patch, expectedPaths);
  const patchHash = hashPatchContent(patch);

  const patchValidation: CanonicalPatchValidationResult =
    gitValidation.status === "passed"
      ? {
          status: "passed",
          gitCliAvailable: true,
          patchGenerationMethod: "git-cli",
          patchHash,
          validatedPaths: gitValidation.validatedPaths,
          gitPatchValidation: { status: "passed" },
          contentIntegrityValidation: { status: "passed" },
          attempt: {
            cleanupRunId: payload.cleanupRunId,
            repository: `${payload.repositoryOwner}/${payload.repositoryName}`,
            baseCommitSha: payload.baseCommitSha,
            patchHash,
            patchByteLength: Buffer.byteLength(patch, "utf8"),
            patchFileCount: expectedPaths.length,
            command: gitValidation.command,
            exitCode: gitValidation.exitCode,
            stdout: gitValidation.stdout,
            stderr: gitValidation.stderr,
            durationMs: 0,
          },
        }
      : {
          status: "failed",
          error: gitValidation.stderr,
          gitCliAvailable: true,
          gitPatchValidation: { status: "failed", failureCode: "GIT_PATCH_INVALID" },
          contentIntegrityValidation: { status: "passed" },
        };

  const repositoryVerification = await runRepositoryVerification({
    baselineRoot,
    edits: payload.edits,
    cleanupRunId: payload.cleanupRunId,
    patch,
  });

  return {
    patchValidation,
    repositoryVerification,
    gitVersion: await getGitVersion(),
    patchHash,
    logs: [],
  };
}

export async function executeRepositoryCleanup(
  runId: string,
  payload: SandboxRunPayload
): Promise<RepositoryExecutionResult> {
  if (isVercelSandboxAvailable()) {
    return executeRepositoryCleanupInSandbox(runId, payload);
  }
  if (!isServerlessRuntime()) {
    return executeRepositoryCleanupLocal(payload);
  }
  throw new Error("SANDBOX_UNAVAILABLE");
}
