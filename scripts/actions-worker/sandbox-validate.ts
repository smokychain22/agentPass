/**
 * Untrusted Actions sandbox-validate job.
 * MUST NOT read Worker/OKX/Redis/signing/App secrets from the environment, and
 * makes ZERO outbound network calls of any kind — the trusted claim job already
 * downloaded the public, commit-pinned archive as a local artifact. This job
 * only extracts it, applies the already-decided edits, and runs the same git
 * validation the local/dev path uses. The trusted complete job reads its
 * output artifact and reports the result.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execa } from "execa";
import { checkFileCount } from "../../src/lib/github-actions/limits";
import { hashPatchContent } from "../../src/lib/patch-kit/canonical-patch";
import { generateGitPatch, getGitVersion, validateGitPatch } from "../../src/lib/execution/git-clone";

const WORK = "/tmp/repodiet-actions";

function assertNoTrustedSecrets(): void {
  const banned = [
    "REPODIET_WORKER_API_KEY",
    "WORKER_API_KEY",
    "REPODIET_WORKER_CALLBACK_SECRET",
    "WORKER_CALLBACK_SECRET",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "OKX_API_KEY",
    "GITHUB_APP_PRIVATE_KEY",
    "RECEIPT_SIGNING_PRIVATE_KEY",
    "GREEN_PR_SIGNING_PRIVATE_KEY",
    "REPODIET_ACTIONS_DISPATCH_TOKEN",
  ];
  for (const key of banned) {
    if (process.env[key]?.trim()) {
      throw new Error(`SECURITY: untrusted sandbox-validate job must not receive ${key}`);
    }
  }
}

async function unzip(archive: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const result = await execa("unzip", ["-q", "-o", archive, "-d", dest], { reject: false });
  if (result.exitCode !== 0) {
    throw new Error(`unzip failed: ${result.stderr || result.stdout}`);
  }
}

async function countFiles(root: string): Promise<number> {
  let count = 0;
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        await walk(full);
      } else {
        count += 1;
        const limit = checkFileCount(count);
        if (limit) throw new Error(`${limit}: exceeded file limit`);
      }
    }
  }
  await walk(root);
  return count;
}

/**
 * git-init the extracted archive so its blob SHAs are content-addressed and
 * therefore identical to the real upstream commit's blobs for unchanged files
 * — this is what lets `git apply --index` validate correctly against a plain
 * zip extraction, with no authenticated clone required.
 */
async function initBaselineGitRepo(root: string): Promise<void> {
  await execa("git", ["init", "-q"], { cwd: root });
  await execa("git", ["config", "user.email", "sandbox-validate@repodiet.local"], { cwd: root });
  await execa("git", ["config", "user.name", "RepoDiet Sandbox Validate"], { cwd: root });
  await execa("git", ["add", "-A"], { cwd: root });
  await execa("git", ["commit", "-q", "-m", "baseline", "--allow-empty"], { cwd: root });
}

type Manifest = {
  runId: string;
  baseCommitSha: string;
  repositoryOwner: string;
  repositoryName: string;
  branch: string;
  edits: Array<{ path: string; content: string }>;
  changeOperations: Array<{ filePath: string; type: string }>;
};

async function main(): Promise<void> {
  assertNoTrustedSecrets();

  const manifestPath = path.join(WORK, "job-manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Manifest;
  const expectedPaths = manifest.changeOperations.map((op) => op.filePath);

  const resultBundle: Record<string, unknown> = {
    runId: manifest.runId,
    baseCommitSha: manifest.baseCommitSha,
  };

  try {
    const zipPath = path.join(WORK, "archive.zip");
    await fs.access(zipPath);

    const unpackRoot = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-sandbox-validate-"));
    await unzip(zipPath, unpackRoot);
    const top = await fs.readdir(unpackRoot);
    const baselineRoot = top.length === 1 ? path.join(unpackRoot, top[0]) : unpackRoot;

    await countFiles(baselineRoot);
    await initBaselineGitRepo(baselineRoot);

    // generateGitPatch mutates its rootDir in place (applies edits, stages them).
    // Run it against a throwaway copy so baselineRoot stays pristine — validateGitPatch
    // clones baselineRoot itself for the actual apply --check, and needs the files it's
    // about to delete/edit to still exist there. Mirrors executeRepositoryCleanupLocal's
    // baseline/transformed split in repository-executor.ts exactly.
    const transformedRoot = path.join(unpackRoot, "transformed");
    await fs.cp(baselineRoot, transformedRoot, { recursive: true, force: true });

    const gitVersion = await getGitVersion();
    const { patch } = await generateGitPatch(transformedRoot, manifest.edits);
    const patchHash = hashPatchContent(patch);
    const validated = await validateGitPatch(baselineRoot, patch, expectedPaths);

    Object.assign(resultBundle, {
      status: validated.status,
      gitApplyExitCode: validated.exitCode,
      gitApplyStderr: validated.stderr,
      validatedPaths: validated.validatedPaths,
      patchHash,
      gitVersion,
    });

    console.log(
      JSON.stringify({
        event: "sandbox_validate_ok",
        runId: manifest.runId,
        status: validated.status,
        validatedPaths: validated.validatedPaths,
      })
    );
  } catch (err) {
    Object.assign(resultBundle, {
      status: "failed",
      gitApplyExitCode: 1,
      error: err instanceof Error ? err.message : String(err),
    });
    console.error("sandbox_validate_error:", err instanceof Error ? err.message : err);
  }

  await fs.writeFile(path.join(WORK, "sandbox-result-bundle.json"), JSON.stringify(resultBundle, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
