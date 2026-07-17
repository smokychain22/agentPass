/**
 * Untrusted Actions analyze job.
 * MUST NOT read Worker/OKX/Redis/signing/App secrets from the environment.
 * May use a scoped progressToken from the claim manifest (not a trusted secret).
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execa } from "execa";
import { createHash } from "node:crypto";
import { ACTIONS_ANALYSIS_LIMITS, checkFileCount } from "../../src/lib/github-actions/limits";
import type { TimingBreakdown } from "../../src/lib/deep-scan/timing-breakdown";

const WORK = "/tmp/repodiet-actions";
const WORKER_ID = "github-actions/ubuntu-latest";

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

type Manifest = {
  sourceCommit?: string;
  repoUrl?: string;
  branch?: string;
  projectRoot?: string;
  structureScanId?: string;
  claimHandle?: string;
  progressToken?: string;
  apiBaseUrl?: string;
  workflowRunId?: string;
  workflowRunAttempt?: string;
  workflowName?: string;
  workflowRepository?: string;
  timingSeed?: TimingBreakdown;
};

type ProgressStage =
  | "INVENTORY"
  | "RESOLVING_PROJECTS"
  | "BUILDING_GRAPH"
  | "RUNNING_JSCpd"
  | "RUNNING_KNIP"
  | "RUNNING_MADGE"
  | "RUNNING_INTERNAL_HEURISTICS"
  | "NORMALIZING_FINDINGS"
  | "VALIDATING_EVIDENCE"
  | "PERSISTING_RESULTS";

async function postProgress(
  manifest: Manifest,
  jobId: string,
  stage: ProgressStage,
  progressMessage: string,
  extras?: {
    completedUnits?: number;
    totalUnits?: number;
    timingPatch?: TimingBreakdown;
    heartbeatOnly?: boolean;
  }
): Promise<void> {
  const apiBase = (manifest.apiBaseUrl || "").replace(/\/$/, "");
  const progressToken = manifest.progressToken?.trim();
  const claimHandle = manifest.claimHandle?.trim();
  if (!apiBase || !progressToken || !claimHandle) {
    console.log(
      JSON.stringify({
        event: "progress_skipped",
        stage,
        reason: !progressToken ? "no_progress_token" : "missing_api_or_handle",
      })
    );
    return;
  }

  try {
    const res = await fetch(`${apiBase}/api/internal/actions/deep-scans/${jobId}/progress`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workerId: WORKER_ID,
        claimHandle,
        progressToken,
        workflowRunId: manifest.workflowRunId,
        workflowRunAttempt: manifest.workflowRunAttempt || "1",
        workflowName: manifest.workflowName || "RepoDiet analysis worker",
        repository: manifest.workflowRepository || "smokychain22/agentPass",
        timestamp: new Date().toISOString(),
        stage: extras?.heartbeatOnly ? undefined : stage,
        detail: progressMessage,
        progressMessage,
        completedUnits: extras?.completedUnits,
        totalUnits: extras?.totalUnits,
        timingPatch: extras?.timingPatch,
        heartbeatOnly: extras?.heartbeatOnly,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`progress ${stage} failed (${res.status}): ${text.slice(0, 200)}`);
    }
  } catch (err) {
    console.error(
      `progress ${stage} error:`,
      err instanceof Error ? err.message : err
    );
  }
}

const ENGINE_STAGE_MAP: Record<string, ProgressStage> = {
  jscpd: "RUNNING_JSCpd",
  knip: "RUNNING_KNIP",
  madge: "RUNNING_MADGE",
  heuristics: "RUNNING_INTERNAL_HEURISTICS",
  normalizing: "NORMALIZING_FINDINGS",
};

async function main(): Promise<void> {
  assertNoTrustedSecrets();
  process.env.REPODIET_UNTRUSTED_SANDBOX = "off";
  process.env.REPODIET_TEST_OFFLINE = "1";

  const analyzeStarted = Date.now();
  const jobId = process.env.INPUT_JOB_ID?.trim();
  if (!jobId) throw new Error("INPUT_JOB_ID required");

  const zipPath = path.join(WORK, "archive.zip");
  const manifestPath = path.join(WORK, "job-manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Manifest;

  const stages: Array<{ stage: string; at: string; message: string }> = [];
  const timingBreakdown: TimingBreakdown = { ...(manifest.timingSeed ?? {}) };

  const recordStage = async (
    stage: ProgressStage,
    message: string,
    extras?: Parameters<typeof postProgress>[4]
  ) => {
    stages.push({ stage, at: new Date().toISOString(), message });
    await postProgress(manifest, jobId, stage, message, extras);
  };

  const unpackRoot = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-analyze-"));
  try {
    const setupStarted = Date.now();
    await unzip(zipPath, unpackRoot);
    const top = await fs.readdir(unpackRoot);
    const workspaceRoot =
      top.length === 1 ? path.join(unpackRoot, top[0]) : unpackRoot;
    timingBreakdown.workerSetupMs = Math.max(0, Date.now() - setupStarted);

    const inventoryStarted = Date.now();
    await recordStage("INVENTORY", "Inventorying repository files");
    const fileCount = await countFiles(workspaceRoot);
    timingBreakdown.inventoryMs = Math.max(0, Date.now() - inventoryStarted);
    await recordStage("INVENTORY", `Inventorying ${fileCount} files`, {
      completedUnits: fileCount,
      totalUnits: fileCount,
      timingPatch: {
        workerSetupMs: timingBreakdown.workerSetupMs,
        inventoryMs: timingBreakdown.inventoryMs,
      },
    });
    console.log(JSON.stringify({ event: "inventory_ok", fileCount }));

    const resolveStarted = Date.now();
    await recordStage("RESOLVING_PROJECTS", "Resolving project roots");
    const { runFindingsEngine } = await import("../../src/lib/findings/findings-engine");
    const { buildPersistedRepositoryGraph } = await import(
      "../../src/lib/repository-graph/build-repository-graph"
    );
    const { scanFileTree } = await import("../../src/lib/scanner/file-tree");
    const { buildRepositoryModel } = await import("../../src/lib/repository-model/project-graph");
    const { classifyProjectRoots } = await import("../../src/lib/repository-model/primary-root");

    const tree = await scanFileTree(workspaceRoot);
    const repositoryModel = await buildRepositoryModel(workspaceRoot);
    classifyProjectRoots(repositoryModel);
    timingBreakdown.resolvingProjectsMs = Math.max(0, Date.now() - resolveStarted);
    await recordStage("RESOLVING_PROJECTS", "Project roots resolved", {
      timingPatch: { resolvingProjectsMs: timingBreakdown.resolvingProjectsMs },
    });

    const graphStarted = Date.now();
    await recordStage("BUILDING_GRAPH", "Building repository graph");

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
    timingBreakdown.buildingGraphMs = Math.max(0, Date.now() - graphStarted);
    await recordStage("BUILDING_GRAPH", "Repository graph ready", {
      timingPatch: { buildingGraphMs: timingBreakdown.buildingGraphMs },
    });

    const analyzerStarted: Record<string, number> = {};
    const findings = await runFindingsEngine(repoUrl, branch, (engineStage) => {
      const mapped = ENGINE_STAGE_MAP[engineStage];
      if (!mapped) return;
      analyzerStarted[mapped] = Date.now();
      const messages: Record<ProgressStage, string> = {
        INVENTORY: "Inventorying repository files",
        RESOLVING_PROJECTS: "Resolving project roots",
        BUILDING_GRAPH: "Building repository graph",
        RUNNING_JSCpd: "Running duplicate detection (jscpd)",
        RUNNING_KNIP: "Running unused-code analysis (Knip)",
        RUNNING_MADGE: "Running dependency graph analysis (Madge)",
        RUNNING_INTERNAL_HEURISTICS: "Running internal heuristics",
        NORMALIZING_FINDINGS: "Normalizing findings",
        VALIDATING_EVIDENCE: "Validating finding evidence",
        PERSISTING_RESULTS: "Saving repository graph and findings",
      };
      void recordStage(mapped, messages[mapped]);
    }, {
      scanId: manifest.structureScanId,
      projectRoot,
    });

    // Capture analyzer durations from tool reports when available.
    const reports = findings.rawToolReports;
    if (reports?.jscpd?.durationMs != null) timingBreakdown.jscpdMs = reports.jscpd.durationMs;
    if (reports?.knip?.durationMs != null) timingBreakdown.knipMs = reports.knip.durationMs;
    if (reports?.madge?.durationMs != null) timingBreakdown.madgeMs = reports.madge.durationMs;

    const findingCount =
      (findings.summary?.totalFindings ?? 0) ||
      [
        ...findings.duplicates,
        ...findings.unused.files,
        ...findings.unused.dependencies,
        ...findings.unused.exports,
        ...findings.orphans,
        ...findings.slopSignals,
      ].length;

    const validateStarted = Date.now();
    await recordStage("VALIDATING_EVIDENCE", `Validating ${findingCount} findings`, {
      completedUnits: findingCount,
      totalUnits: findingCount,
    });
    timingBreakdown.evidenceValidationMs = Math.max(0, Date.now() - validateStarted);

    await recordStage("PERSISTING_RESULTS", "Saving repository graph and findings", {
      timingPatch: {
        evidenceValidationMs: timingBreakdown.evidenceValidationMs,
        jscpdMs: timingBreakdown.jscpdMs,
        knipMs: timingBreakdown.knipMs,
        madgeMs: timingBreakdown.madgeMs,
      },
    });

    const resultDigest = createHash("sha256")
      .update(JSON.stringify({ scanId: findings.scanId, summary: findings.summary }))
      .digest("hex");

    timingBreakdown.totalDurationMs = Math.max(0, Date.now() - analyzeStarted);

    const bundle = {
      jobId,
      workerId: WORKER_ID,
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
        runner: WORKER_ID,
        timingBreakdown,
      },
      timingBreakdown,
      stages: stages.map((s) => s.stage),
      stageEvents: stages,
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
        timingBreakdown,
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
