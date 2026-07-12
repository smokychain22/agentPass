import { prepareRepoWorkspace } from "@/lib/scanner/prepare-workspace";
import { scanFileTree } from "@/lib/scanner/file-tree";
import { detectFramework } from "@/lib/scanner/detect-framework";
import { detectPackageManager } from "@/lib/scanner/detect-package-manager";
import { detectConfigFiles } from "@/lib/scanner/detect-config-files";
import { RepoFetchError } from "@/lib/github/fetch-repo-zip";
import { buildRepositoryModel } from "@/lib/repository-model/project-graph";
import { classifyProjectRoots } from "@/lib/repository-model/primary-root";
import { isDoNotTouchPath } from "@/lib/findings/confidence-path-rules";
import type { ScanJobStage } from "@/lib/jobs/types";
import { createScanId } from "@/lib/scan/app-scan-store";
import {
  listSelectableApplicationRoots,
  needsProjectRootSelection,
  resolveSelectedProjectRoot,
} from "@/lib/repository-model/project-root-selection";
import type { ScanCoverageReport, RepositoryIntelligenceManifest } from "@/lib/scanner/intelligence-manifest";
import { buildRepositoryIntelligenceManifest } from "@/lib/scanner/intelligence-manifest";
import type { ScanResult } from "@/lib/scanner/types";

export interface ScanRepositoryModel {
  projects: Array<Record<string, unknown>>;
  workspaces: string[];
  monorepoTool?: string | null;
  primaryProjectRoot: string;
  protectedFileCount: number;
  analyzableSourceFiles: number;
  needsProjectRootSelection?: boolean;
  selectableApplications?: Array<{
    projectRoot: string;
    packageName?: string;
    framework: string;
    role: string;
    reason: string;
  }>;
}

export interface ScanPayload extends ScanResult {
  id: string;
  repositoryModel?: ScanRepositoryModel;
  intelligenceManifest?: RepositoryIntelligenceManifest;
  scanCoverage?: ScanCoverageReport;
}

export async function runBasicScan(
  repoUrl: string,
  branchInput?: string,
  onStage?: (stage: ScanJobStage) => void,
  options?: { selectedProjectRoot?: string }
): Promise<ScanPayload> {
  onStage?.("resolving_branch");
  onStage?.("downloading_archive");
  const workspace = await prepareRepoWorkspace(repoUrl, branchInput, onStage);

  try {
    onStage?.("inventorying_files");
    const tree = await scanFileTree(workspace.rootDir);
    onStage?.("detecting_frameworks");
    const framework = await detectFramework(workspace.rootDir);
    const pm = await detectPackageManager(workspace.rootDir);
    const configs = await detectConfigFiles(workspace.rootDir, tree.allRelativePaths);
    onStage?.("detecting_project_roots");
    const repositoryModel = await buildRepositoryModel(workspace.rootDir);
    const projects = classifyProjectRoots(repositoryModel);
    const selectableApplications = listSelectableApplicationRoots(repositoryModel);
    const needsRootSelection = needsProjectRootSelection(repositoryModel);
    const primaryProjectRoot =
      resolveSelectedProjectRoot(repositoryModel, options?.selectedProjectRoot) || ".";
    onStage?.("detecting_protected_paths");
    const analyzableSourceFiles = tree.allRelativePaths.filter((p) =>
      /\.(tsx?|jsx?|mjs|cjs)$/.test(p)
    ).length;
    const protectedFileCount = tree.allRelativePaths.filter((p) => isDoNotTouchPath(p)).length;

    const scanId = createScanId();
    const intelligenceManifest = await buildRepositoryIntelligenceManifest({
      scanId,
      repo: {
        owner: workspace.repo.owner,
        name: workspace.repo.name,
        branch: workspace.repo.branch,
        url: workspace.repo.url,
        commitSha: workspace.repo.commitSha,
        workspaceSource: workspace.repo.workspaceSource,
      },
      tree,
      framework,
      packageManager: pm.packageManager,
      lockfile: pm.lockfile,
      configFiles: configs.configFiles,
      warnings: configs.warnings,
      repositoryModel,
      projects,
      primaryProjectRoot,
      rootDir: workspace.rootDir,
    });

    return {
      id: scanId,
      repo: {
        ...workspace.repo,
        commitSha: workspace.repo.commitSha,
      },
      framework,
      packageManager: pm.packageManager,
      packageManagerLockfile: pm.lockfile,
      summary: tree.summary,
      topLevelFolders: tree.topLevelFolders,
      configFiles: configs.configFiles,
      largestFiles: tree.largestFiles,
      warnings: configs.warnings,
      repositoryModel: {
        projects: projects.map((p) => ({
          packageName: p.packageName,
          projectRoot: p.relativePath || ".",
          framework: p.framework,
          runtimeTarget: p.runtimeTarget,
          workspaceMember: p.workspaceMember ?? false,
          role: p.role,
        })),
        workspaces: repositoryModel.workspaces,
        monorepoTool: repositoryModel.monorepoTool,
        primaryProjectRoot,
        protectedFileCount,
        analyzableSourceFiles,
        needsProjectRootSelection: needsRootSelection,
        selectableApplications,
      },
      intelligenceManifest,
      scanCoverage: intelligenceManifest.coverage,
    };
  } catch (err) {
    const message =
      err instanceof RepoFetchError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Scan failed unexpectedly.";
    throw new Error(message);
  } finally {
    await workspace.cleanup();
  }
}
