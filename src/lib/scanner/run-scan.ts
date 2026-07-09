import { randomUUID } from "node:crypto";
import { prepareRepoWorkspace } from "@/lib/scanner/prepare-workspace";
import { scanFileTree } from "@/lib/scanner/file-tree";
import { detectFramework } from "@/lib/scanner/detect-framework";
import { detectPackageManager } from "@/lib/scanner/detect-package-manager";
import { detectConfigFiles } from "@/lib/scanner/detect-config-files";
import { RepoFetchError } from "@/lib/github/fetch-repo-zip";
import type { ScanResult } from "@/lib/scanner/types";

export interface ScanPayload extends ScanResult {
  id: string;
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

    return {
      id: randomUUID(),
      repo: workspace.repo,
      framework,
      packageManager: pm.packageManager,
      packageManagerLockfile: pm.lockfile,
      summary: tree.summary,
      topLevelFolders: tree.topLevelFolders,
      configFiles: configs.configFiles,
      largestFiles: tree.largestFiles,
      warnings: configs.warnings,
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
