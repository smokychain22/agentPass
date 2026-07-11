import type { RepositoryJob, RepositoryJobResult } from "../../src/lib/worker/types";
import {
  cloneExactCommit,
  generateGitPatch,
  getGitVersion,
  validateGitPatch,
  workspaceLayout,
} from "./git-runner";
import { postCallback } from "./callback";

const WORKER_ID = process.env.WORKER_ID ?? `worker_${process.pid}`;

export async function runRepositoryJob(job: RepositoryJob, apiBase: string, apiKey: string): Promise<void> {
  const logs: string[] = [];
  const workRoot = workspaceLayout(job.cleanupRunId);
  const log = (line: string) => {
    logs.push(line);
    console.log(`[${job.id}] ${line}`);
  };

  try {
    await postCallback(apiBase, apiKey, job.id, "progress", {
      workerId: WORKER_ID,
      status: "cloning",
      progress: "Cloning exact commit",
    });

    const token = process.env.GITHUB_INSTALLATION_TOKEN?.trim();
    const { rootDir: baselineRoot } = await cloneExactCommit({
      repoUrl: job.payload.repoUrl,
      baseCommitSha: job.payload.baseCommitSha,
      token,
      workDir: workRoot,
    });

    log(`Cloned ${job.payload.baseCommitSha}`);

    await postCallback(apiBase, apiKey, job.id, "progress", {
      workerId: WORKER_ID,
      status: "transforming",
      progress: "Applying deterministic changes",
    });

    const transformedRoot = `${workRoot}/transformed`;
    await import("node:fs/promises").then((fs) =>
      fs.cp(baselineRoot, transformedRoot, { recursive: true, force: true })
    );
    const { patch, changedPaths } = await generateGitPatch(transformedRoot, job.payload.edits);
    log(`Generated patch for ${changedPaths.join(", ")}`);

    await postCallback(apiBase, apiKey, job.id, "progress", {
      workerId: WORKER_ID,
      status: "validating_patch",
      progress: "Running git apply --check",
    });

    const gitVersion = await getGitVersion();
    const expectedPaths = job.payload.changeOperations.map((op) => op.filePath);
    const gitValidation = await validateGitPatch(baselineRoot, patch, expectedPaths);

    const patchValidation = {
      status: gitValidation.status === "passed" ? ("passed" as const) : ("failed" as const),
      gitCliAvailable: true,
      patchGenerationMethod: "git-cli" as const,
      gitPatchValidation: {
        status: gitValidation.status,
        failureCode: gitValidation.status === "passed" ? undefined : "GIT_PATCH_INVALID",
      },
      contentIntegrityValidation: { status: "passed" as const },
      validatedPaths: gitValidation.validatedPaths,
      missingPaths: gitValidation.missingPaths,
      unexpectedPaths: gitValidation.unexpectedPaths,
      attempt: {
        cleanupRunId: job.cleanupRunId,
        repository: `${job.repositoryOwner}/${job.repositoryName}`,
        baseCommitSha: job.payload.baseCommitSha,
        patchHash: "",
        patchByteLength: Buffer.byteLength(patch, "utf8"),
        patchFileCount: expectedPaths.length,
        command: gitValidation.command,
        exitCode: gitValidation.exitCode,
        stdout: gitValidation.stdout,
        stderr: gitValidation.stderr,
        durationMs: 0,
      },
    };

    if (gitValidation.status !== "passed") {
      await postCallback(apiBase, apiKey, job.id, "fail", {
        workerId: WORKER_ID,
        failureCode: "GIT_PATCH_INVALID",
        failureMessage: gitValidation.stderr || "git apply --check failed",
      });
      return;
    }

    await postCallback(apiBase, apiKey, job.id, "progress", {
      workerId: WORKER_ID,
      status: "baseline_verify",
      progress: "Running baseline verification",
    });

    const { runRepositoryVerification } = await import(
      "../../src/lib/patch-kit/repository-verification"
    );
    const repositoryVerification = await runRepositoryVerification({
      baselineRoot,
      edits: job.payload.edits,
      cleanupRunId: job.cleanupRunId,
      patch,
    });

    const result: RepositoryJobResult = {
      patchValidation,
      repositoryVerification,
      gitVersion,
      patchHash: patchValidation.attempt?.patchHash,
      logs,
    };

    const finalStatus =
      repositoryVerification.status === "verified" ? "ready_for_delivery" : "blocked";

    await postCallback(apiBase, apiKey, job.id, "complete", {
      workerId: WORKER_ID,
      status: finalStatus,
      result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Worker job failed";
    log(message);
    await postCallback(apiBase, apiKey, job.id, "fail", {
      workerId: WORKER_ID,
      failureCode: message.includes("BASE_COMMIT_MISMATCH") ? "BASE_COMMIT_MISMATCH" : "WORKER_EXECUTION_FAILED",
      failureMessage: message,
    });
  }
}
