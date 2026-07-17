import { parseGitHubUrl } from "@/lib/github/parse-github-url";
import { runBasicScan } from "@/lib/scanner/run-scan";
import { prepareRepoWorkspace } from "@/lib/scanner/prepare-workspace";
import { scanFileTree } from "@/lib/scanner/file-tree";
import { buildRepositoryModel } from "@/lib/repository-model/project-graph";
import { classifyProjectRoots } from "@/lib/repository-model/primary-root";
import { buildPersistedRepositoryGraph } from "@/lib/repository-graph/build-repository-graph";
import { saveRepositoryGraph } from "@/lib/repository-graph/graph-store";
import { runFindingsEngine } from "@/lib/findings/findings-engine";
import { toEvidenceStandardFindings } from "@/lib/findings/evidence-standard";
import { detectPackageManager } from "@/lib/scanner/detect-package-manager";
import { detectFramework } from "@/lib/scanner/detect-framework";
import {
  assertDeepScanClaim,
  failDeepScanJob,
  getDeepScanJob,
  heartbeatDeepScanJob,
  updateDeepScanStage,
} from "./job-store";
import type { DeepScanJob } from "./types";
import { packageScriptsAllowed, SandboxIncompleteError } from "@/lib/sandbox/untrusted-runner";

/** No repository receives privileged marketplace treatment by name. */
function repositoryClassLabel(_owner: string, _name: string): string {
  return "CUSTOMER_REPOSITORY";
}

async function detectBaselineCommands(rootDir: string): Promise<{
  packageManager: string;
  lockfile?: string;
  scripts: string[];
  commands: {
    install?: string;
    typecheck?: string;
    build?: string;
    test?: string;
    lint?: string;
  };
  notes: string[];
}> {
  const pm = await detectPackageManager(rootDir);
  const framework = await detectFramework(rootDir);
  let scripts: Record<string, string> = {};
  try {
    const raw = await import("node:fs/promises").then((fs) =>
      fs.readFile(`${rootDir}/package.json`, "utf8")
    );
    scripts = (JSON.parse(raw) as { scripts?: Record<string, string> }).scripts ?? {};
  } catch {
    scripts = {};
  }
  const scriptNames = Object.keys(scripts);
  const runner =
    pm.packageManager === "pnpm"
      ? "pnpm"
      : pm.packageManager === "yarn"
        ? "yarn"
        : pm.packageManager === "bun"
          ? "bun"
          : "npm";
  const run = (name: string) =>
    runner === "npm" ? `npm run ${name}` : `${runner} ${name}`;

  const notes: string[] = [];
  const commands: {
    install?: string;
    typecheck?: string;
    build?: string;
    test?: string;
    lint?: string;
  } = {
    install:
      runner === "npm"
        ? "npm ci"
        : runner === "pnpm"
          ? "pnpm install --frozen-lockfile"
          : runner === "yarn"
            ? "yarn install --frozen-lockfile"
            : "bun install --frozen-lockfile",
  };

  if (scriptNames.includes("typecheck")) commands.typecheck = run("typecheck");
  else if (scriptNames.includes("tsc")) commands.typecheck = run("tsc");
  else notes.push("No dedicated typecheck script detected.");

  if (scriptNames.includes("build")) commands.build = run("build");
  else notes.push("No build script detected.");

  if (scriptNames.includes("test")) commands.test = run("test");
  else if (scriptNames.includes("test:unit")) commands.test = run("test:unit");
  else notes.push("No test script detected.");

  if (scriptNames.includes("lint")) commands.lint = run("lint");

  notes.push(`Framework detection: ${framework.name} (confidence ${framework.confidence}).`);

  return {
    packageManager: pm.packageManager,
    lockfile: pm.lockfile,
    scripts: scriptNames,
    commands,
    notes,
  };
}

export async function executeDeepScanJob(
  jobId: string,
  workerId: string,
  options?: { alreadyClaimed?: boolean; claimToken?: string }
): Promise<DeepScanJob | undefined> {
  let job = await getDeepScanJob(jobId);
  if (!job) return undefined;

  // Single atomic claim happens only in claim-next / claimNextDeepScanJob.
  if (options?.alreadyClaimed !== true) {
    throw new Error(
      "executeDeepScanJob requires alreadyClaimed=true — claiming is exclusive to claim-next"
    );
  }
  assertDeepScanClaim(job, workerId, options.claimToken ?? job.claimToken);
  const claimToken = options.claimToken ?? job.claimToken;

  // Read-only deep scans must not run customer package scripts until Docker isolation is COMPLETE.
  const readOnly = job.request.readOnly !== false;
  if (!readOnly && !packageScriptsAllowed()) {
    return failDeepScanJob(jobId, "SANDBOX_INCOMPLETE", new SandboxIncompleteError().message, {
      terminal: true,
    });
  }

  try {
    await heartbeatDeepScanJob(jobId, workerId, "Starting inventory", claimToken);
    job =
      (await updateDeepScanStage(jobId, "INVENTORY", "Downloading repository and inventorying files")) ??
      job;

    const parsed = parseGitHubUrl(job.request.repoUrl);
    const scan = await runBasicScan(job.request.repoUrl, job.request.branch, undefined, {
      selectedProjectRoot: job.request.projectRoot,
    });

    job =
      (await updateDeepScanStage(jobId, "RESOLVING_PROJECTS", "Resolving project roots", {
        repositoryOwner: scan.repo.owner,
        repositoryName: scan.repo.name,
        branch: scan.repo.branch,
        sourceCommit: scan.repo.commitSha,
        projectRoot: scan.repositoryModel?.primaryProjectRoot || job.request.projectRoot || ".",
        scanId: scan.id,
        coverage: scan.scanCoverage?.contract as unknown as Record<string, unknown>,
      })) ?? job;

    await heartbeatDeepScanJob(jobId, workerId, "Building repository graph", claimToken);
    job =
      (await updateDeepScanStage(jobId, "BUILDING_GRAPH", "Building persistent repository graph")) ??
      job;

    const workspace = await prepareRepoWorkspace(job.request.repoUrl, job.request.branch);
    try {
      const tree = await scanFileTree(workspace.rootDir);
      const repositoryModel = await buildRepositoryModel(workspace.rootDir);
      classifyProjectRoots(repositoryModel);
      const graph = await buildPersistedRepositoryGraph({
        repository: `${scan.repo.owner}/${scan.repo.name}`,
        branch: scan.repo.branch,
        sourceCommit: scan.repo.commitSha || "unknown",
        projectRoot: scan.repositoryModel?.primaryProjectRoot || ".",
        rootDir: workspace.rootDir,
        tree,
        repositoryModel,
        packageScripts: scan.intelligenceManifest?.structure.packageScripts,
        tsconfigPaths: scan.intelligenceManifest?.structure.tsconfigPaths,
      });
      await saveRepositoryGraph(graph);

      job =
        (await updateDeepScanStage(jobId, "RUNNING_ANALYZERS", "Running findings analyzers", {
          graphId: graph.id,
        })) ?? job;

      await heartbeatDeepScanJob(jobId, workerId, "Running findings engine", claimToken);
      const findings = await runFindingsEngine(job.request.repoUrl, job.request.branch, undefined, {
        scanId: job.request.structureScanId || job.scanId,
        projectRoot: job.request.projectRoot || job.projectRoot,
      });

      job =
        (await updateDeepScanStage(jobId, "NORMALIZING_FINDINGS", "Normalizing findings")) ?? job;
      const evidenceFindings = toEvidenceStandardFindings(findings);

      job =
        (await updateDeepScanStage(jobId, "VALIDATING_EVIDENCE", "Validating finding evidence")) ??
        job;

      // Read package.json scripts for reporting only — never execute install/build/test/lint here.
      const detectedCommands = await detectBaselineCommands(workspace.rootDir);
      let baseline: Record<string, unknown>;
      if (!job.request.readOnly) {
        if (!packageScriptsAllowed()) {
          baseline = {
            status: "SANDBOX_REQUIRED",
            verification: "NOT_RUN",
            ...detectedCommands,
            note:
              "Baseline install/typecheck/build/test were NOT executed. Untrusted sandbox is incomplete — no false build verification.",
          };
        } else {
          job =
            (await updateDeepScanStage(
              jobId,
              "BASELINE_VERIFICATION",
              "Detecting baseline commands (execution deferred to twin-build worker)"
            )) ?? job;
          baseline = {
            status: "COMMANDS_DETECTED",
            verification: "NOT_RUN",
            ...detectedCommands,
            note:
              "Full baseline install/typecheck/build runs in the isolated twin-build worker before PR delivery. This stage records detected commands only.",
          };
        }
      } else {
        baseline = {
          status: "NOT_RUN",
          verification: "SANDBOX_REQUIRED",
          reason: "READ_ONLY_FINDINGS",
          ...detectedCommands,
          note:
            "Read-only findings mode: archive, inventory, graph, and static analyzers only. npm install, lifecycle scripts, build, test, lint, and arbitrary package.json commands are prohibited.",
        };
      }

      const resultSummary = {
        repository: `${scan.repo.owner}/${scan.repo.name}`,
        branch: scan.repo.branch,
        sourceCommit: scan.repo.commitSha,
        coverage: scan.scanCoverage?.contract,
        inventory: scan.intelligenceManifest?.inventory,
        entryPoints: scan.intelligenceManifest?.entryPoints?.length ?? 0,
        findings: {
          total: findings.summary.totalFindings,
          safeCandidates: findings.summary.safeCandidates,
          reviewFirst: findings.summary.reviewRequired,
          doNotTouch: findings.summary.doNotTouch,
        },
        evidenceStandardCount: evidenceFindings.length,
        graphId: graph.id,
        repositoryClass: repositoryClassLabel(
          parsed?.owner ?? scan.repo.owner,
          parsed?.repo ?? scan.repo.name
        ),
        tenantId: job.request.tenantId,
      };

      job =
        (await updateDeepScanStage(jobId, "READY", "Deep scan complete", {
          findingsId: findings.scanId,
          baseline,
          resultSummary,
          coverage: scan.scanCoverage?.contract as unknown as Record<string, unknown>,
        })) ?? job;

      return job;
    } finally {
      await workspace.cleanup();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Deep scan failed";
    return failDeepScanJob(jobId, "DEEP_SCAN_FAILED", message);
  }
}
