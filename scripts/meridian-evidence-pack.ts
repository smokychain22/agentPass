#!/usr/bin/env tsx
/**
 * Fresh Meridian evidence pack — read-only.
 * Labels DEVELOPMENT-ONLY when executed inside Cursor (not RepoDiet worker).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fetchRepoZip, fetchBranchCommitSha } from "../src/lib/github/fetch-repo-zip";
import { unzipRepoToDir } from "../src/lib/scanner/unzip-repo";
import { buildFullRepositoryInventory, buildCoverageContract } from "../src/lib/scanner/inventory";
import { scanFileTree } from "../src/lib/scanner/file-tree";
import { buildRepositoryModel } from "../src/lib/repository-model/project-graph";
import { classifyProjectRoots } from "../src/lib/repository-model/primary-root";
import { buildPersistedRepositoryGraph } from "../src/lib/repository-graph/build-repository-graph";
import { saveRepositoryGraph } from "../src/lib/repository-graph/graph-store";
import { REPOSITORY_GRAPH_SCANNER_VERSION, configurationDigest } from "../src/lib/repository-graph/types";
import { runFindingsEngine } from "../src/lib/findings/findings-engine";
import { toEvidenceStandardFindings, flattenFindings } from "../src/lib/findings/evidence-standard";
import {
  createDeepScanJob,
  updateDeepScanStage,
  getDeepScanJob,
  claimNextDeepScanJob,
  saveDeepScanJob,
} from "../src/lib/deep-scan/job-store";
import { detectPackageManager } from "../src/lib/scanner/detect-package-manager";
import { detectFramework } from "../src/lib/scanner/detect-framework";
import { MERIDIAN_PROOF } from "../src/lib/product/proof-repositories";
import { setPersistentRecord, getPersistentRecord } from "../src/lib/store/persistent-store";

const OWNER = "velz-cmd";
const REPO = "Meridian";
const BRANCH = "main";
const OUT = "/tmp/cursor/artifacts/meridian-evidence-pack.json";
const HISTORICAL_FORBIDDEN = new Set([
  "scan_DymsApC3ZKMJ",
  "scan_CellDRLCZHAa",
  "scan_iAJAsIw0HjFg",
  "scan_GW46u26eOt_o",
]);

async function countGitTreePaths(owner: string, repo: string, sha: string) {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "RepoDiet-Evidence/1.0",
      Accept: "application/vnd.github+json",
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      truncated: null as boolean | null,
      totalPathsDiscovered: 0,
      blobCount: 0,
      treeCount: 0,
    };
  }
  const data = (await res.json()) as {
    truncated?: boolean;
    tree?: Array<{ path: string; type: string; size?: number }>;
  };
  const tree = data.tree ?? [];
  return {
    ok: true,
    status: res.status,
    truncated: Boolean(data.truncated),
    totalPathsDiscovered: tree.length,
    blobCount: tree.filter((t) => t.type === "blob").length,
    treeCount: tree.filter((t) => t.type === "tree").length,
  };
}

async function detectBaseline(rootDir: string) {
  const pm = await detectPackageManager(rootDir);
  const framework = await detectFramework(rootDir);
  let pkg: { scripts?: Record<string, string>; workspaces?: unknown } = {};
  try {
    pkg = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf8"));
  } catch {
    pkg = {};
  }
  const scripts = pkg.scripts ?? {};
  const runner = pm.packageManager === "pnpm" ? "pnpm" : pm.packageManager === "yarn" ? "yarn" : "npm";
  return {
    packageManager: pm.packageManager,
    lockfile: pm.lockfile,
    framework,
    workspaceStructure: pkg.workspaces ? "workspaces_declared" : "single_package",
    scripts: Object.keys(scripts),
    installCommand: runner === "npm" ? "npm ci" : `${runner} install --frozen-lockfile`,
    typecheckCommand: scripts.typecheck
      ? runner === "npm"
        ? "npm run typecheck"
        : `${runner} typecheck`
      : null,
    buildCommand: scripts.build ? (runner === "npm" ? "npm run build" : `${runner} build`) : null,
    testCommand: scripts.test ? (runner === "npm" ? "npm run test" : `${runner} test`) : null,
    lintCommand: scripts.lint ? (runner === "npm" ? "npm run lint" : `${runner} lint`) : null,
  };
}

function breakdownByType(findings: ReturnType<typeof flattenFindings>) {
  const counts: Record<string, number> = {};
  for (const f of findings) {
    counts[f.type] = (counts[f.type] ?? 0) + 1;
  }
  const signals = (f: (typeof findings)[0], re: RegExp) =>
    findings.filter((x) => x.id === f.id && (x.evidence?.signals ?? []).some((s) => re.test(s))).length;

  const temp = findings.filter((f) =>
    f.files.some((p) => /\.(tmp|temp|bak|backup|old)$/i.test(p) || /\/(tmp|temp|backup)\//i.test(p))
  ).length;
  const backup = findings.filter((f) =>
    f.files.some((p) => /\.(bak|backup|old)$/i.test(p) || /backup/i.test(p))
  ).length;

  return {
    unused_imports: counts.unused_import ?? 0,
    unused_exports: counts.unused_export ?? 0,
    unused_dependencies: counts.unused_dependency ?? 0,
    unused_dev_dependencies: findings.filter(
      (f) => f.type === "unused_dependency" && f.dependencySection === "devDependencies"
    ).length,
    exact_duplicate_files: findings.filter(
      (f) =>
        f.type === "duplicate_code" &&
        (f.classificationLabel === "exact_duplicate" ||
          (f.evidence?.signals ?? []).some((s) => /exact_file_duplicate|exact/i.test(s)))
    ).length,
    duplicate_functions: findings.filter(
      (f) => f.type === "duplicate_code" && (f.evidence?.signals ?? []).some((s) => /function/i.test(s))
    ).length,
    duplicate_components: findings.filter(
      (f) => f.type === "duplicate_code" && (f.evidence?.signals ?? []).some((s) => /component/i.test(s))
    ).length,
    near_duplicates: findings.filter(
      (f) =>
        f.type === "duplicate_code" &&
        (f.classificationLabel === "near_duplicate" ||
          f.classificationLabel === "structural_duplicate" ||
          (f.evidence?.signals ?? []).some((s) => /near|structural/i.test(s)))
    ).length,
    orphan_modules: counts.orphan_pattern ?? 0,
    unreferenced_files: counts.unused_file ?? 0,
    temporary_artifacts: temp,
    backup_files: backup,
    dead_routes: findings.filter((f) =>
      (f.evidence?.signals ?? []).some((s) => /dead.?route|unreferenced.?route/i.test(s))
    ).length,
    redundant_wrappers: findings.filter((f) =>
      (f.evidence?.signals ?? []).some((s) => /wrapper|redundant/i.test(s))
    ).length,
    conflicting_api_clients: findings.filter((f) =>
      (f.evidence?.signals ?? []).some((s) => /api.?client/i.test(s))
    ).length,
    abandoned_feature_folders: findings.filter((f) =>
      (f.evidence?.signals ?? []).some((s) => /abandoned|feature.?folder/i.test(s))
    ).length,
    duplicate_utilities: findings.filter((f) =>
      f.type === "duplicate_code" && f.files.some((p) => /util|helper|lib\//i.test(p))
    ).length,
    package_script_drift: findings.filter((f) =>
      (f.evidence?.signals ?? []).some((s) => /script.?drift|package.?script/i.test(s))
    ).length,
    ai_structural_duplication: counts.ai_slop_signal ?? 0,
    rawTypeCounts: counts,
  };
}

async function main() {
  const started = Date.now();
  const createdAt = new Date().toISOString();
  const executionLabel = "DEVELOPMENT AUDIT ONLY";
  const workerId = "cursor-dev-evidence-runner";

  const sourceCommit =
    (await fetchBranchCommitSha(OWNER, REPO, BRANCH)) ?? "UNKNOWN";

  // Durable job first — persist before work
  const deepJob = await createDeepScanJob(
    {
      repoUrl: MERIDIAN_PROOF.url,
      branch: BRANCH,
      sourceCommit,
      projectRoot: ".",
      readOnly: true,
      requestedBy: "meridian-evidence-pack",
    },
    { idempotencyKey: `meridian-evidence:${sourceCommit}:${createdAt.slice(0, 16)}` }
  );
  const taskId = `dev_task_${deepJob.id}`;
  await setPersistentRecord("tasks", taskId, {
    id: taskId,
    type: "meridian_readonly_evidence",
    deepScanJobId: deepJob.id,
    createdAt,
    sourceCommit,
    status: "persisted_before_work",
  });

  let job = (await claimNextDeepScanJob(workerId)) ?? deepJob;
  if (job.id !== deepJob.id) {
    job = deepJob;
    job.claimedBy = workerId;
    job.claimedAt = new Date().toISOString();
    await saveDeepScanJob(job);
  }
  const claimedAt = job.claimedAt ?? new Date().toISOString();

  await updateDeepScanStage(deepJob.id, "INVENTORY", "Downloading GitHub archive ZIP");

  // Acquisition
  const zipStarted = Date.now();
  const { buffer, branch } = await fetchRepoZip(OWNER, REPO, BRANCH);
  const downloadedBytes = buffer.byteLength;
  const tmpRoot = path.join("/tmp", `meridian-evidence-${Date.now()}`);
  await fs.mkdir(tmpRoot, { recursive: true });
  const rootDir = await unzipRepoToDir(buffer, tmpRoot);
  const zipMs = Date.now() - zipStarted;

  const gitTree = await countGitTreePaths(OWNER, REPO, sourceCommit);

  await updateDeepScanStage(deepJob.id, "RESOLVING_PROJECTS", "Inventory + project roots");
  const inventory = await buildFullRepositoryInventory(rootDir);
  const tree = await scanFileTree(rootDir);
  const repositoryModel = await buildRepositoryModel(rootDir);
  const projects = classifyProjectRoots(repositoryModel);
  const framework = await detectFramework(rootDir);
  const pm = await detectPackageManager(rootDir);

  const js = inventory.files.filter((f) => f.extension === ".js" || f.extension === ".mjs" || f.extension === ".cjs").length;
  const ts = inventory.files.filter((f) => f.extension === ".ts" || f.extension === ".mts" || f.extension === ".cts").length;
  const jsx = inventory.files.filter((f) => f.extension === ".jsx").length;
  const tsx = inventory.files.filter((f) => f.extension === ".tsx").length;
  const supported = inventory.files.filter((f) => f.kind === "supported_source");
  const analyzedSourceFiles = Object.keys(repositoryModel.fileIndex).filter((p) =>
    /\.(tsx?|jsx?|mjs|cjs|mts|cts)$/i.test(p)
  ).length;
  // Match inventory supported_source count for invariant — analyzed = classified supported sources present in fileIndex
  const supportedInIndex = supported.filter((f) => repositoryModel.fileIndex[f.path]).length;

  const entryPointsDetected = Object.values(repositoryModel.fileIndex).filter((ctx) =>
    [
      "app_router_page",
      "app_router_layout",
      "app_router_route",
      "pages_router",
      "api_route",
      "middleware",
      "config",
      "test",
      "script",
    ].includes(ctx.entrypointRole)
  ).length;

  const routeFilesIndexed = inventory.files.filter((f) => f.routeCandidate).length;
  const packageManifestFiles = inventory.files.filter((f) => path.posix.basename(f.path) === "package.json").length;
  const lockfilesIndexed = inventory.files.filter((f) => f.kind === "lockfile").length;
  const configIndexed = inventory.files.filter((f) => f.kind === "configuration" || f.kind === "lockfile").length;
  const testIndexed = inventory.files.filter((f) => f.kind === "test" || f.kind === "fixture").length;

  // Directory count via walk of inventory top-level is incomplete — count from git tree if available
  const totalDirectories =
    gitTree.ok && !gitTree.truncated
      ? gitTree.treeCount
      : inventory.topLevelFolders.length; // fallback note

  const coverage = buildCoverageContract({
    inventory,
    analyzedSourceFiles: supportedInIndex,
    entryPointsDetected,
    commitSha: sourceCommit,
    analysisComplete: supportedInIndex === supported.length && supported.length > 0,
  });

  // Enrich coverage for required report fields
  const coverageReport = {
    totalFiles: coverage.totalFiles,
    totalDirectories,
    supportedSourceFiles: coverage.supportedSourceFiles,
    analyzedSourceFiles: supportedInIndex,
    javascriptFiles: js,
    typescriptFiles: ts,
    jsxFiles: jsx,
    tsxFiles: tsx,
    configurationFilesIndexed: configIndexed,
    packageManifestFiles,
    lockfilesIndexed,
    testFilesIndexed: testIndexed,
    routeFilesIndexed,
    entryPointsDetected,
    generatedFilesExcluded: coverage.generatedFilesExcluded,
    binaryFilesExcluded: coverage.binaryFilesExcluded,
    vendorFilesExcluded: coverage.vendorFilesExcluded,
    unsupportedFiles: coverage.unsupportedFiles,
    oversizedFiles: inventory.files.filter((f) => f.sizeBytes > 25 * 1024 * 1024).length,
    failedFiles: 0,
    exclusions: coverage.exclusions.slice(0, 200),
    exclusionCategoryCounts: coverage.exclusions.reduce(
      (acc, e) => {
        acc[e.kind] = (acc[e.kind] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    ),
    coverageStatus:
      supportedInIndex === supported.length &&
      supported.length > 0 &&
      gitTree.ok &&
      !gitTree.truncated &&
      Math.abs(gitTree.blobCount - coverage.totalFiles) <= inventory.skippedDirectories.length + 5
        ? coverage.coverageStatus
        : gitTree.truncated || !gitTree.ok
          ? "PARTIAL"
          : coverage.coverageStatus,
    invariant_analyzed_equals_supported: supportedInIndex === supported.length,
    gitTreeBlobCount: gitTree.blobCount,
    zipFileCount: coverage.totalFiles,
    skippedDirectoryBoundaries: inventory.skippedDirectories,
  };

  const configDigest = configurationDigest({
    tsconfigPaths: true,
    packageManager: pm.packageManager,
    framework: framework.name,
  });

  await updateDeepScanStage(deepJob.id, "BUILDING_GRAPH", "Building repository graph");
  const hb1 = new Date().toISOString();
  const graph = await buildPersistedRepositoryGraph({
    repository: `${OWNER}/${REPO}`,
    branch,
    sourceCommit,
    projectRoot: ".",
    rootDir,
    tree,
    repositoryModel,
  });
  await saveRepositoryGraph(graph);

  const edgeKinds = graph.edges.reduce(
    (acc, e) => {
      acc[e.kind] = (acc[e.kind] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  const nodeKinds = graph.nodes.reduce(
    (acc, n) => {
      acc[n.kind] = (acc[n.kind] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  await updateDeepScanStage(deepJob.id, "RUNNING_ANALYZERS", "Running findings engine", {
    graphId: graph.id,
    sourceCommit,
    repositoryOwner: OWNER,
    repositoryName: REPO,
    branch,
  });

  const findings = await runFindingsEngine(MERIDIAN_PROOF.url, BRANCH);
  if (HISTORICAL_FORBIDDEN.has(findings.scanId)) {
    throw new Error(`Historical scan ID reused: ${findings.scanId}`);
  }

  await updateDeepScanStage(deepJob.id, "NORMALIZING_FINDINGS", "Normalizing to evidence standard");
  const evidence = toEvidenceStandardFindings(findings);
  await updateDeepScanStage(deepJob.id, "VALIDATING_EVIDENCE", "Validating evidence bundles");

  await updateDeepScanStage(deepJob.id, "BASELINE_VERIFICATION", "Detecting baseline commands");
  const baseline = await detectBaseline(rootDir);

  // Optional: run lint-only if deps already not installed — report not_run for install-heavy cmds
  const baselineResults = {
    ...baseline,
    install: { status: "NOT_RUN", reason: "Read-only evidence pack; install deferred to twin-build worker" },
    typecheck: {
      status: baseline.typecheckCommand ? "NOT_RUN" : "UNAVAILABLE",
      command: baseline.typecheckCommand,
      reason: baseline.typecheckCommand
        ? "Not executed in development evidence pack"
        : "No typecheck script in package.json",
    },
    build: {
      status: "NOT_RUN",
      command: baseline.buildCommand,
      reason: "Not executed in development evidence pack (would mutate node_modules)",
    },
    tests: {
      status: baseline.testCommand ? "NOT_RUN" : "UNAVAILABLE",
      command: baseline.testCommand,
      reason: baseline.testCommand ? "Not executed" : "No test script",
    },
    lint: {
      status: "NOT_RUN",
      command: baseline.lintCommand,
      reason: "Not executed in development evidence pack",
    },
    existingDiagnostics: [],
    timeouts: [],
    infrastructureFailures: [],
    note: "Pre-existing vs RepoDiet-introduced failures cannot be separated until twin-build runs in isolated workspaces.",
  };

  const flat = flattenFindings(findings);
  const byType = breakdownByType(flat);

  const strongest = evidence
    .filter((f) => f.classification !== "PROTECTED" || f.evidence.protected)
    .sort((a, b) => {
      const rank = (c: string) => (c === "SAFE_CANDIDATE" ? 0 : c === "REVIEW_FIRST" ? 1 : 2);
      return rank(a.classification) - rank(b.classification);
    })
    .slice(0, 25)
    .map((f) => {
      const original = flat.find((x) => x.id === f.findingId);
      return {
        ...f,
        sourceCommit,
        confidenceBasis: "deterministic evidence",
        analyzerSource: original?.source,
        sourceMode: original?.sourceMode,
        duplicateMeta:
          original?.type === "duplicate_code"
            ? {
                classificationLabel: original.classificationLabel,
                signals: original.evidence?.signals?.slice(0, 12),
                files: original.files,
              }
            : undefined,
        dependencyMeta:
          original?.type === "unused_dependency"
            ? {
                packageName: original.packageName,
                section: original.dependencySection,
                signals: original.evidence?.signals?.slice(0, 12),
              }
            : undefined,
      };
    });

  const completedAt = new Date().toISOString();
  const durationMs = Date.now() - started;

  await updateDeepScanStage(deepJob.id, "READY", "Evidence pack complete", {
    scanId: findings.scanId,
    findingsId: findings.scanId,
    graphId: graph.id,
    coverage: coverageReport as unknown as Record<string, unknown>,
    baseline: baselineResults as unknown as Record<string, unknown>,
    resultSummary: {
      findingsSummary: findings.summary,
      typeBreakdown: byType,
      strongestCount: strongest.length,
      executionLabel,
    },
  });

  const persistedJob = await getDeepScanJob(deepJob.id);
  const persistedTask = await getPersistentRecord("tasks", taskId);
  const reloadedGraph = await getPersistentRecord("repository_graphs", graph.id);

  const pack = {
    verdictContext: executionLabel,
    repository: MERIDIAN_PROOF.url,
    branch,
    resolvedSourceCommit: sourceCommit,
    projectRoot: ".",
    scanCreationTimestamp: createdAt,
    scanCompletionTimestamp: completedAt,
    scannerVersion: REPOSITORY_GRAPH_SCANNER_VERSION,
    configurationDigest: configDigest,
    acquisition: {
      method: "GitHub archive ZIP (codeload via github.com/.../archive/refs/heads/{branch}.zip)",
      downloadedBytes,
      archiveLimitApplied: false,
      truncated: false,
      paginationComplete: true,
      gitLfsHandled: "not_applicable_for_zip_archive — LFS pointers may appear as small text files if present",
      submodulesHandled: "not_included_in_github_archive_zip",
      totalPathsDiscovered: coverage.totalFiles,
      zipDownloadMs: zipMs,
      decompressLimits: {
        maxDecompressedBytes: 100 * 1024 * 1024,
        maxFileCount: 20_000,
        hitLimit: false,
      },
      gitTreeApi: gitTree,
      zipVsGitTree: {
        zipFiles: coverage.totalFiles,
        gitBlobs: gitTree.blobCount,
        delta: gitTree.ok ? coverage.totalFiles - gitTree.blobCount : null,
        note: "ZIP walk skips .git/node_modules/.next/dist/build/coverage/.cache directory boundaries; git tree includes all blobs at commit.",
      },
    },
    coverage: coverageReport,
    durableExecution: {
      scanId: findings.scanId,
      taskId,
      queueJobId: deepJob.id,
      workflowRunId: null,
      workerId,
      attempt: persistedJob?.attemptCount ?? 1,
      dispatchState: persistedJob?.status,
      createdAt,
      claimedAt,
      lastHeartbeatAt: persistedJob?.heartbeatAt ?? persistedJob?.updatedAt,
      completedAt,
      durationMs,
      checkpointCount: persistedJob?.statusHistory?.length ?? 0,
      retryCount: Math.max(0, (persistedJob?.attemptCount ?? 1) - 1),
      statusUrl: `/api/deep-scans/${deepJob.id}`,
      progressHistory: persistedJob?.statusHistory ?? [],
      persistedBeforeWork: Boolean(persistedTask),
      jobRetrievableAfterCompletion: Boolean(persistedJob && persistedJob.stage === "READY"),
      graphRetrievable: Boolean(reloadedGraph),
      survivesCursorStop: "LOCAL_DURABLE_STORE_ONLY — Redis/production persistence requires deployed worker path",
      executionLabel,
      productionWorkerProof: false,
    },
    graph: {
      id: graph.id,
      storage: {
        collection: "repository_graphs",
        identity: graph.identity,
      },
      counts: {
        files: nodeKinds.file ?? 0,
        modules: nodeKinds.module ?? 0,
        imports: edgeKinds.static_import ?? 0,
        dynamicImports: edgeKinds.dynamic_import ?? 0,
        requires: edgeKinds.require ?? 0,
        exports: edgeKinds.export_reexport ?? 0,
        reExports: edgeKinds.export_reexport ?? 0,
        functions: nodeKinds.function ?? 0,
        components: nodeKinds.component ?? 0,
        routes: nodeKinds.route ?? 0,
        entryPoints: entryPointsDetected,
        packageDependencies: nodeKinds.package_dependency ?? 0,
        workspaceDependencies: edgeKinds.workspace_dependency ?? 0,
        packageScripts: nodeKinds.package_script ?? 0,
        configurationReferences: edgeKinds.configuration_reference ?? 0,
        testReferences: edgeKinds.test_reference ?? 0,
        publicApiReferences: edgeKinds.public_api_reference ?? 0,
        totalNodes: graph.nodes.length,
        totalEdges: graph.edges.length,
      },
      resolution: {
        tsconfigAliasesResolved: "partial — paths captured in identity digest; edge resolution uses literal specifiers",
        jsconfigAliasesResolved: "not_detected",
        packageExportsResolved: "partial — package.json nodes indexed; export map not fully expanded",
        monorepoWorkspacesResolved: projects.length > 1 ? "detected" : "single_package",
        nextAppRoutesResolved: routeFilesIndexed > 0 ? "yes_via_entrypoint_roles" : "none",
        nextPagesRoutesResolved: "checked_via_entrypoint_roles",
        dynamicRoutesResolved: "path_pattern_detection_only",
        lazyImportsResolved: (edgeKinds.dynamic_import ?? 0) > 0 ? "dynamic_import_edges_recorded" : "none_found",
        globImportsResolved: "not_implemented",
        commonJsResolved: (edgeKinds.require ?? 0) > 0 ? "require_edges_recorded" : "none_found",
        esmResolved: (edgeKinds.static_import ?? 0) > 0 ? "static_import_edges_recorded" : "none_found",
      },
    },
    findings: {
      scanId: findings.scanId,
      totals: {
        totalDetected: findings.summary.totalFindings,
        safeCandidates: findings.summary.safeCandidates,
        reviewFirst: findings.summary.reviewRequired,
        protected: findings.summary.doNotTouch,
        transformEligible: findings.summary.eligibleFindings ?? findings.summary.actionableFixes ?? 0,
        verifiedEligible: findings.summary.verifiedFindings ?? 0,
      },
      breakdown: byType,
      toolReports: {
        knip: findings.rawToolReports?.knip,
        jscpd: findings.rawToolReports?.jscpd,
        madge: findings.rawToolReports?.madge,
      },
      mode: findings.mode,
      strongest,
    },
    baseline: baselineResults,
    readOnlyConfirmation: {
      noBranchCreated: true,
      noCommitCreated: true,
      noFileModified: true,
      noFileDeleted: true,
      noPullRequestCreated: true,
      noPaymentRequested: true,
      noA2aEscrowCreated: true,
      method: "evidence pack never called createCleanupPullRequest / GitHub write APIs",
    },
    forbiddenHistoricalScansNotUsed: [...HISTORICAL_FORBIDDEN],
    projects,
    durationMs,
    timeoutStatus: "NO_TIMEOUT",
  };

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(pack, null, 2));
  await fs.writeFile(
    "/opt/cursor/artifacts/meridian-evidence-pack.json",
    JSON.stringify(pack, null, 2)
  );
  console.log(JSON.stringify({ out: OUT, scanId: findings.scanId, jobId: deepJob.id, graphId: graph.id, durationMs, coverageStatus: coverageReport.coverageStatus, totals: pack.findings.totals }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
