import fs from "node:fs/promises";
import path from "node:path";
import { isDoNotTouchPath } from "@/lib/findings/confidence-path-rules";
import type { WorkspaceSource } from "@/lib/scanner/prepare-workspace";
import type { RepositoryModel, EntrypointRole } from "@/lib/repository-model/types";
import type { ClassifiedProjectRoot } from "@/lib/repository-model/primary-root";
import type { FrameworkDetection, PackageManager } from "@/lib/scanner/types";
import type { FileTreeScan } from "@/lib/scanner/file-tree";
import { IGNORED_DIRS } from "@/lib/scanner/types";
import {
  buildCoverageContract,
  type CoverageStatusContract,
  type RepositoryCoverageContract,
} from "@/lib/scanner/inventory";

/** Legacy status values kept for existing UI consumers. */
export type ScanCoverageStatus =
  | "complete"
  | "complete_with_exclusions"
  | "partial"
  | "failed";

export interface ScanCoverageReport {
  status: ScanCoverageStatus;
  /** Truthful product coverage contract (preferred). */
  coverageStatus: CoverageStatusContract;
  filesDiscovered: number;
  filesClassified: number;
  filesAnalyzable: number;
  filesProtected: number;
  filesExcluded: number;
  entryPointsDetected: number;
  warnings: string[];
  /** False when coverage is partial/failed — Findings must not claim a clean bill of health. */
  readinessForFindings: boolean;
  /** Full inventory contract for production honesty. */
  contract: RepositoryCoverageContract;
}

export interface RepositoryIntelligenceManifest {
  identity: {
    owner: string;
    name: string;
    branch: string;
    url: string;
    commitSha?: string;
    workspaceSource?: WorkspaceSource;
    scannedAt: string;
    scanId: string;
  };
  structure: {
    framework: FrameworkDetection;
    packageManager: PackageManager;
    lockfile?: string;
    monorepoTool?: string | null;
    workspaces: string[];
    projects: Array<{
      packageName: string;
      projectRoot: string;
      framework: string;
      runtimeTarget: string;
      role: string;
      workspaceMember: boolean;
    }>;
    primaryProjectRoot: string;
    configFiles: string[];
    packageScripts: Array<{ name: string; command: string; projectRoot: string }>;
    tsconfigPaths?: Record<string, string[]>;
  };
  inventory: {
    totalFiles: number;
    totalFolders: number;
    analyzableSourceFiles: number;
    protectedFileCount: number;
    intentionallyIgnoredDirs: string[];
    topExtensions: Record<string, number>;
    supportedSourceFiles: number;
    analyzedSourceFiles: number;
    configurationFilesIndexed: number;
    testFilesIndexed: number;
    generatedFilesExcluded: number;
    binaryFilesExcluded: number;
    vendorFilesExcluded: number;
    unsupportedFiles: number;
  };
  entryPoints: Array<{
    path: string;
    role: EntrypointRole;
    framework: string;
    projectRoot: string;
    runtimeTarget: string;
  }>;
  coverage: ScanCoverageReport;
}

const ANALYZABLE_EXT = /\.(tsx?|jsx?|mjs|cjs)$/i;

const ENTRYPOINT_ROLES = new Set<EntrypointRole>([
  "app_router_page",
  "app_router_layout",
  "app_router_route",
  "pages_router",
  "api_route",
  "middleware",
  "config",
  "test",
  "script",
]);

async function readPackageScripts(
  rootDir: string,
  projects: ClassifiedProjectRoot[]
): Promise<Array<{ name: string; command: string; projectRoot: string }>> {
  const scripts: Array<{ name: string; command: string; projectRoot: string }> = [];
  const seen = new Set<string>();

  for (const project of projects) {
    const pkgPath = path.join(rootDir, project.relativePath || ".", "package.json");
    try {
      const raw = await fs.readFile(pkgPath, "utf8");
      const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
      const projectRoot = project.relativePath || ".";
      for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
        const key = `${projectRoot}:${name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        scripts.push({ name, command, projectRoot });
      }
    } catch {
      /* skip */
    }
  }

  return scripts.sort((a, b) => a.name.localeCompare(b.name));
}

async function readTsconfigPaths(
  rootDir: string,
  primaryProjectRoot: string
): Promise<Record<string, string[]> | undefined> {
  const candidates = [
    path.join(rootDir, primaryProjectRoot === "." ? "" : primaryProjectRoot, "tsconfig.json"),
    path.join(rootDir, "tsconfig.json"),
  ].filter(Boolean);

  for (const file of candidates) {
    try {
      const raw = await fs.readFile(file, "utf8");
      const ts = JSON.parse(raw) as {
        compilerOptions?: { paths?: Record<string, string[]> };
      };
      if (ts.compilerOptions?.paths && Object.keys(ts.compilerOptions.paths).length > 0) {
        return ts.compilerOptions.paths;
      }
    } catch {
      /* try next */
    }
  }
  return undefined;
}

function mapLegacyStatus(contractStatus: CoverageStatusContract): ScanCoverageStatus {
  if (contractStatus === "FAILED") return "failed";
  if (contractStatus === "PARTIAL") return "partial";
  return "complete_with_exclusions";
}

export function computeScanCoverage(input: {
  tree: FileTreeScan;
  repositoryModel: RepositoryModel;
  analyzableSourceFiles: number;
  protectedFileCount: number;
  commitSha?: string;
  warnings: string[];
  analyzedSourceFiles?: number;
  analysisComplete?: boolean;
}): ScanCoverageReport {
  const inventory = input.tree.inventory;
  const entryPointsDetected = Object.values(input.repositoryModel.fileIndex).filter((ctx) =>
    ENTRYPOINT_ROLES.has(ctx.entrypointRole)
  ).length;

  const supportedSourceFiles =
    inventory?.files.filter((f) => f.kind === "supported_source").length ??
    input.tree.allRelativePaths.filter((p) => ANALYZABLE_EXT.test(p)).length;

  const analyzedSourceFiles =
    input.analyzedSourceFiles ??
    Math.min(
      input.analyzableSourceFiles,
      Object.keys(input.repositoryModel.fileIndex).filter((p) => ANALYZABLE_EXT.test(p)).length
    );

  const contract = inventory
    ? buildCoverageContract({
        inventory,
        analyzedSourceFiles,
        entryPointsDetected,
        commitSha: input.commitSha,
        analysisComplete: input.analysisComplete ?? Boolean(input.commitSha && analyzedSourceFiles > 0),
      })
    : ({
        totalFiles: input.tree.summary.totalFiles,
        supportedSourceFiles,
        analyzedSourceFiles,
        configurationFilesIndexed: 0,
        testFilesIndexed: 0,
        entryPointsDetected,
        generatedFilesExcluded: 0,
        binaryFilesExcluded: 0,
        vendorFilesExcluded: 0,
        unsupportedFiles: Math.max(0, input.tree.summary.totalFiles - supportedSourceFiles),
        protectedFiles: input.protectedFileCount,
        exclusions: [],
        coverageStatus:
          input.tree.summary.totalFiles === 0 || supportedSourceFiles === 0
            ? "FAILED"
            : !input.commitSha || analyzedSourceFiles < supportedSourceFiles
              ? "PARTIAL"
              : "COMPLETE_FOR_SUPPORTED_SCOPE",
        supportedLanguages: ["javascript", "typescript"],
        claimsSemanticAnalysisOfAllFiles: false,
      } satisfies RepositoryCoverageContract);

  const coverageWarnings = [...input.warnings];
  if (!input.commitSha) {
    coverageWarnings.push("Commit SHA could not be resolved — findings may not pin to an exact tree.");
  }
  if (contract.totalFiles === 0) {
    coverageWarnings.push("No files discovered in repository archive.");
  }
  if (contract.analyzedSourceFiles < contract.supportedSourceFiles) {
    coverageWarnings.push(
      `Analyzed ${contract.analyzedSourceFiles} of ${contract.supportedSourceFiles} supported JS/TS source files.`
    );
  }
  coverageWarnings.push(
    "RepoDiet supports JavaScript/TypeScript semantic analysis only. Binaries, generated output, and unsupported languages are inventoried and excluded — not claimed as analyzed."
  );

  const status = mapLegacyStatus(contract.coverageStatus);
  const readinessForFindings = contract.coverageStatus === "COMPLETE_FOR_SUPPORTED_SCOPE";

  return {
    status,
    coverageStatus: contract.coverageStatus,
    filesDiscovered: contract.totalFiles,
    filesClassified: Object.keys(input.repositoryModel.fileIndex).length,
    filesAnalyzable: contract.supportedSourceFiles,
    filesProtected: contract.protectedFiles,
    filesExcluded:
      contract.generatedFilesExcluded +
      contract.binaryFilesExcluded +
      contract.vendorFilesExcluded +
      contract.unsupportedFiles,
    entryPointsDetected: contract.entryPointsDetected,
    warnings: coverageWarnings,
    readinessForFindings,
    contract,
  };
}

export async function buildRepositoryIntelligenceManifest(input: {
  scanId: string;
  repo: {
    owner: string;
    name: string;
    branch: string;
    url: string;
    commitSha?: string;
    workspaceSource?: WorkspaceSource;
  };
  tree: FileTreeScan;
  framework: FrameworkDetection;
  packageManager: PackageManager;
  lockfile?: string;
  configFiles: string[];
  warnings: string[];
  repositoryModel: RepositoryModel;
  projects: ClassifiedProjectRoot[];
  primaryProjectRoot: string;
  rootDir: string;
}): Promise<RepositoryIntelligenceManifest> {
  const analyzableSourceFiles =
    input.tree.inventory?.files.filter((f) => f.kind === "supported_source").length ??
    input.tree.allRelativePaths.filter((p) => ANALYZABLE_EXT.test(p)).length;
  const protectedFileCount =
    input.tree.inventory?.files.filter((f) => f.protected).length ??
    input.tree.allRelativePaths.filter((p) => isDoNotTouchPath(p)).length;

  const analyzedSourceFiles = Object.keys(input.repositoryModel.fileIndex).filter((p) =>
    ANALYZABLE_EXT.test(p)
  ).length;

  const entryPoints = Object.entries(input.repositoryModel.fileIndex)
    .filter(([, ctx]) => ENTRYPOINT_ROLES.has(ctx.entrypointRole))
    .map(([filePath, ctx]) => ({
      path: filePath,
      role: ctx.entrypointRole,
      framework: ctx.framework,
      projectRoot: ctx.projectRoot || ".",
      runtimeTarget: ctx.runtimeTarget,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const packageScripts = await readPackageScripts(input.rootDir, input.projects);
  const tsconfigPaths = await readTsconfigPaths(input.rootDir, input.primaryProjectRoot);

  const coverage = computeScanCoverage({
    tree: input.tree,
    repositoryModel: input.repositoryModel,
    analyzableSourceFiles,
    protectedFileCount,
    commitSha: input.repo.commitSha,
    warnings: input.warnings,
    analyzedSourceFiles,
    analysisComplete: true,
  });

  return {
    identity: {
      owner: input.repo.owner,
      name: input.repo.name,
      branch: input.repo.branch,
      url: input.repo.url,
      commitSha: input.repo.commitSha,
      workspaceSource: input.repo.workspaceSource,
      scannedAt: new Date().toISOString(),
      scanId: input.scanId,
    },
    structure: {
      framework: input.framework,
      packageManager: input.packageManager,
      lockfile: input.lockfile,
      monorepoTool: input.repositoryModel.monorepoTool ?? null,
      workspaces: input.repositoryModel.workspaces,
      projects: input.projects.map((p) => ({
        packageName: p.packageName,
        projectRoot: p.relativePath || ".",
        framework: p.framework,
        runtimeTarget: p.runtimeTarget,
        role: p.role,
        workspaceMember: p.workspaceMember ?? false,
      })),
      primaryProjectRoot: input.primaryProjectRoot,
      configFiles: input.configFiles,
      packageScripts,
      tsconfigPaths,
    },
    inventory: {
      totalFiles: input.tree.summary.totalFiles,
      totalFolders: input.tree.summary.totalFolders,
      analyzableSourceFiles,
      protectedFileCount,
      intentionallyIgnoredDirs: [...IGNORED_DIRS],
      topExtensions: input.tree.summary.topExtensions,
      supportedSourceFiles: coverage.contract.supportedSourceFiles,
      analyzedSourceFiles: coverage.contract.analyzedSourceFiles,
      configurationFilesIndexed: coverage.contract.configurationFilesIndexed,
      testFilesIndexed: coverage.contract.testFilesIndexed,
      generatedFilesExcluded: coverage.contract.generatedFilesExcluded,
      binaryFilesExcluded: coverage.contract.binaryFilesExcluded,
      vendorFilesExcluded: coverage.contract.vendorFilesExcluded,
      unsupportedFiles: coverage.contract.unsupportedFiles,
    },
    entryPoints,
    coverage,
  };
}
