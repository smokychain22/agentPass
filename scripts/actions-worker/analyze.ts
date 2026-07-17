/**
 * Untrusted Actions analyze job.
 * MUST NOT read Worker/OKX/Redis/signing/App secrets from the environment.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execa } from "execa";
import { createHash } from "node:crypto";
import { ACTIONS_ANALYSIS_LIMITS, checkFileCount } from "../../src/lib/github-actions/limits";

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
      throw new Error(`SECURITY: untrusted analyze job must not receive ${key}`);
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
        if (limit) throw new Error(`${limit}: exceeded ${ACTIONS_ANALYSIS_LIMITS.maxFiles} files`);
      }
    }
  }
  await walk(root);
  return count;
}

async function main(): Promise<void> {
  assertNoTrustedSecrets();
  process.env.REPODIET_UNTRUSTED_SANDBOX = "off";
  process.env.REPODIET_TEST_OFFLINE = "1";

  const jobId = process.env.INPUT_JOB_ID?.trim();
  if (!jobId) throw new Error("INPUT_JOB_ID required");

  const zipPath = path.join(WORK, "archive.zip");
  const manifestPath = path.join(WORK, "job-manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as {
    sourceCommit?: string;
    repoUrl?: string;
    branch?: string;
    projectRoot?: string;
    structureScanId?: string;
  };

  const unpackRoot = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-analyze-"));
  try {
    await unzip(zipPath, unpackRoot);
    const top = await fs.readdir(unpackRoot);
    const workspaceRoot =
      top.length === 1
        ? path.join(unpackRoot, top[0])
        : unpackRoot;

    const fileCount = await countFiles(workspaceRoot);
    console.log(JSON.stringify({ event: "inventory_ok", fileCount }));

    const { runFindingsEngine } = await import("../../src/lib/findings/findings-engine");
    const { buildPersistedRepositoryGraph } = await import(
      "../../src/lib/repository-graph/build-repository-graph"
    );
    const { scanFileTree } = await import("../../src/lib/scanner/file-tree");
    const { buildRepositoryModel } = await import("../../src/lib/repository-model/project-graph");
    const { classifyProjectRoots } = await import("../../src/lib/repository-model/primary-root");

    // Progress heartbeats are owned by the trusted complete/progress path; analyze stays secretless.
    const tree = await scanFileTree(workspaceRoot);
    const repositoryModel = await buildRepositoryModel(workspaceRoot);
    classifyProjectRoots(repositoryModel);

    const repoUrl = manifest.repoUrl || "https://github.com/unknown/unknown";
    const branch = manifest.branch || "main";
    const sourceCommit =
      process.env.INPUT_SOURCE_COMMIT?.trim() || manifest.sourceCommit || "unknown";
    const projectRoot = manifest.projectRoot || ".";

    const ownerRepo = repoUrl.replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "");
    const graph = await buildPersistedRepositoryGraph({
      repository: ownerRepo,
      branch,
      sourceCommit,
      projectRoot,
      rootDir: workspaceRoot,
      tree,
      repositoryModel,
    });

    // runFindingsEngine prepares its own workspace from URL — prefer local path via engine if supported.
    // For Actions, re-run using the downloaded workspace by temporarily pointing through prepare — use URL public fetch as fallback.
    const findings = await runFindingsEngine(repoUrl, branch, undefined, {
      scanId: manifest.structureScanId,
      projectRoot,
    });

    const resultDigest = createHash("sha256")
      .update(JSON.stringify({ scanId: findings.scanId, summary: findings.summary }))
      .digest("hex");

    const bundle = {
      jobId,
      workerId: "github-actions/ubuntu-latest",
      sourceCommit,
      resultDigest,
      findings,
      graph: {
        id: graph.id,
        repository: ownerRepo,
        branch,
        sourceCommit,
        projectRoot,
      },
      coverage: null,
      baseline: {
        status: "NOT_RUN",
        verification: "SANDBOX_REQUIRED",
        reason: "READ_ONLY_FINDINGS",
        note: "GitHub Actions untrusted job: no npm install/build/test/lint/package scripts.",
      },
      resultSummary: {
        findings: findings.summary,
        fileCount,
        workerMode: "github_actions_on_demand",
        runner: "github-actions/ubuntu-latest",
      },
      stages: [
        "INVENTORY",
        "RESOLVING_PROJECTS",
        "BUILDING_GRAPH",
        "RUNNING_ANALYZERS",
        "NORMALIZING_FINDINGS",
        "VALIDATING_EVIDENCE",
      ],
    };

    await fs.writeFile(path.join(WORK, "result-bundle.json"), JSON.stringify(bundle));
    console.log(
      JSON.stringify({
        event: "analyze_ok",
        jobId,
        findingsId: findings.scanId,
        graphId: graph.id,
        resultDigest,
        fileCount,
      })
    );
  } finally {
    await fs.rm(unpackRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
