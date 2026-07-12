import fs from "node:fs/promises";
import path from "node:path";
import { isDoNotTouchPath } from "@/lib/findings/confidence-path-rules";
import type { WorkspaceSource } from "@/lib/scanner/prepare-workspace";
import type { RepositoryModel, EntrypointRole } from "@/lib/repository-model/types";
import type { ClassifiedProjectRoot } from "@/lib/repository-model/primary-root";
import type { FrameworkDetection, PackageManager } from "@/lib/scanner/types";
import type { FileTreeScan } from "@/lib/scanner/file-tree";
import { IGNORED_DIRS } from "@/lib/scanner/types";

export type ScanCoverageStatus =
  | "complete"
  | "complete_with_exclusions"
  | "partial"
  | "failed";

export interface ScanCoverageReport {
  status: ScanCoverageStatus;
  filesDiscovered: number;
  filesClassified: number;
  filesAnalyzable: number;
  filesProtected: number;
  filesExcluded: number;
  entryPointsDetected: number;
  warnings: string[];
  /** False when coverage is partial/failed — Findings must not claim a clean bill of health. */
  readinessForFindings: boolean;
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

export function computeScanCoverage(input: {
  tree: FileTreeScan;
  repositoryModel: RepositoryModel;
  analyzableSourceFiles: number;
  protectedFileCount: number;
  commitSha?: string;
  warnings: string[];
}): ScanCoverageReport {
  const filesDiscovered = input.tree.summary.totalFiles;
  const filesClassified = Object.keys(input.repositoryModel.fileIndex).length;
  const analyzablePaths = input.tree.allRelativePaths.filter((p) => ANALYZABLE_EXT.test(p));
  const filesAnalyzable = input.analyzableSourceFiles;
  const filesProtected = input.protectedFileCount;

  const classifiedAnalyzable = analyzablePaths.filter((p) => input.repositoryModel.fileIndex[p]).length;
  const filesExcluded = Math.max(0, filesDiscovered - filesClassified);

  const entryPointsDetected = Object.values(input.repositoryModel.fileIndex).filter((ctx) =>
    ENTRYPOINT_ROLES.has(ctx.entrypointRole)
  ).length;

  const coverageWarnings = [...input.warnings];
  if (!input.commitSha) {
    coverageWarnings.push("Commit SHA could not be resolved — findings may not pin to an exact tree.");
  }
  if (filesDiscovered === 0) {
    coverageWarnings.push("No files discovered in repository archive.");
  }
  if (filesAnalyzable > 0 && classifiedAnalyzable < filesAnalyzable * 0.85) {
    coverageWarnings.push(
      `Only ${classifiedAnalyzable} of ${filesAnalyzable} analyzable source files were classified (${Math.round((classifiedAnalyzable / filesAnalyzable) * 100)}%).`
    );
  }

  let status: ScanCoverageStatus = "complete";
  if (filesDiscovered === 0 || filesAnalyzable === 0) {
    status = "failed";
  } else if (!input.commitSha || classifiedAnalyzable < filesAnalyzable * 0.85) {
    status = "partial";
  } else if (filesExcluded > 0 || filesProtected > 0) {
    status = "complete_with_exclusions";
  }

  const readinessForFindings = status === "complete" || status === "complete_with_exclusions";

  return {
    status,
    filesDiscovered,
    filesClassified,
    filesAnalyzable,
    filesProtected,
    filesExcluded,
    entryPointsDetected,
    warnings: coverageWarnings,
    readinessForFindings,
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
  const analyzableSourceFiles = input.tree.allRelativePaths.filter((p) => ANALYZABLE_EXT.test(p)).length;
  const protectedFileCount = input.tree.allRelativePaths.filter((p) => isDoNotTouchPath(p)).length;

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
    },
    entryPoints,
    coverage,
  };
}
