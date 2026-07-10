import { nanoid } from "nanoid";
import { prepareRepoWorkspace } from "@/lib/scanner/prepare-workspace";
import { scanFileTree } from "@/lib/scanner/file-tree";
import { detectFramework } from "@/lib/scanner/detect-framework";
import { detectPackageManager } from "@/lib/scanner/detect-package-manager";
import { detectConfigFiles } from "@/lib/scanner/detect-config-files";
import { RepoFetchError } from "@/lib/github/fetch-repo-zip";
import { buildRepositoryModel } from "@/lib/repository-model/project-graph";
import {
  classifyProjectRoots,
  selectPrimaryProjectRoot,
} from "@/lib/repository-model/primary-root";
import { isDoNotTouchPath } from "@/lib/findings/confidence-path-rules";
import { createScanId } from "@/lib/scan/app-scan-store";
import type { ScanResult } from "@/lib/scanner/types";

export interface ScanRepositoryModel {
  projects: Array<Record<string, unknown>>;
  workspaces: string[];
  monorepoTool?: string | null;
  primaryProjectRoot: string;
  protectedFileCount: number;
  analyzableSourceFiles: number;
}

export interface ScanPayload extends ScanResult {
  id: string;
  repositoryModel?: ScanRepositoryModel;
}

export async function runBasicScan(
  repoUrl: string,
  branchInput?: string
): Promise<ScanPayload> {
  const workspace = await prepareRepoWorkspace(repoUrl, branchInput);

  try {
    const framework = await detectFramework(workspace.rootDir);
    const pm = await detectPackageManager(workspace.rootDir);
    const tree = await scanFileTree(workspace.rootDir);
    const configs = await detectConfigFiles(workspace.rootDir, tree.allRelativePaths);
    const repositoryModel = await buildRepositoryModel(workspace.rootDir);
    const primaryProjectRoot = selectPrimaryProjectRoot(repositoryModel);
    const projects = classifyProjectRoots(repositoryModel);
    const analyzableSourceFiles = tree.allRelativePaths.filter((p) =>
      /\.(tsx?|jsx?|mjs|cjs)$/.test(p)
    ).length;
    const protectedFileCount = tree.allRelativePaths.filter((p) => isDoNotTouchPath(p)).length;

    return {
      id: createScanId(),
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
        primaryProjectRoot: primaryProjectRoot || ".",
        protectedFileCount,
        analyzableSourceFiles,
      },
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
