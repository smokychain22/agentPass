import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseGitHubUrl, buildRepoUrl } from "@/lib/github/parse-github-url";
import { fetchRepoZip, RepoFetchError } from "@/lib/github/fetch-repo-zip";
import { unzipRepoToDir } from "@/lib/scanner/unzip-repo";
import { scanFileTree } from "@/lib/scanner/file-tree";
import { detectFramework } from "@/lib/scanner/detect-framework";
import { detectPackageManager } from "@/lib/scanner/detect-package-manager";
import { detectConfigFiles } from "@/lib/scanner/detect-config-files";
import type { ScanResult } from "@/lib/scanner/types";

export interface ScanPayload extends ScanResult {
  id: string;
}

export async function runBasicScan(
  repoUrl: string,
  branchInput?: string
): Promise<ScanPayload> {
  const id = randomUUID();
  let workDir: string | null = null;

  try {
    const parsed = parseGitHubUrl(repoUrl);
    if (!parsed) {
      throw new Error(
        "Invalid GitHub URL. Use https://github.com/owner/repo or github.com/owner/repo."
      );
    }

    const branchOverride =
      branchInput?.trim() || parsed.branch || undefined;

    const { buffer, branch } = await fetchRepoZip(
      parsed.owner,
      parsed.repo,
      branchOverride
    );

    workDir = path.join(os.tmpdir(), `repodiet-${randomUUID()}`);
    await fs.mkdir(workDir, { recursive: true });

    const rootDir = await unzipRepoToDir(buffer, workDir);

    const framework = await detectFramework(rootDir);
    const pm = await detectPackageManager(rootDir);
    const tree = await scanFileTree(rootDir);
    const configs = await detectConfigFiles(rootDir, tree.allRelativePaths);

    return {
      id,
      repo: {
        owner: parsed.owner,
        name: parsed.repo,
        branch,
        url: buildRepoUrl(parsed.owner, parsed.repo),
      },
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
    if (workDir) {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
