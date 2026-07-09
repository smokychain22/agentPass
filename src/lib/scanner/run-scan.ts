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
import type { ScanPhase, ScanResult } from "@/lib/scanner/types";
import { getScan, updateScan } from "@/lib/scanner/store";

export async function executeScan(
  scanId: string,
  onPhase?: (phase: ScanPhase) => void
): Promise<ScanResult> {
  const record = getScan(scanId);
  if (!record) throw new Error("Scan not found.");

  const setPhase = (phase: ScanPhase) => {
    updateScan(scanId, { status: phase });
    onPhase?.(phase);
  };

  let workDir: string | null = null;

  try {
    setPhase("validating");
    const parsed = parseGitHubUrl(record.url);
    if (!parsed) {
      throw new Error(
        "Invalid GitHub URL. Use https://github.com/owner/repo or github.com/owner/repo."
      );
    }

    const branchOverride = record.branch || parsed.branch;

    setPhase("fetching");
    const { buffer, branch } = await fetchRepoZip(
      parsed.owner,
      parsed.repo,
      branchOverride
    );

    workDir = path.join(os.tmpdir(), `repodiet-${randomUUID()}`);
    await fs.mkdir(workDir, { recursive: true });

    setPhase("unpacking");
    const rootDir = await unzipRepoToDir(buffer, workDir);

    setPhase("detecting");
    const framework = await detectFramework(rootDir);
    const pm = await detectPackageManager(rootDir);

    setPhase("scanning");
    const tree = await scanFileTree(rootDir);
    const configs = await detectConfigFiles(rootDir, tree.allRelativePaths);

    const result: ScanResult = {
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

    updateScan(scanId, { status: "complete", result, error: undefined });
    setPhase("complete");
    return result;
  } catch (err) {
    const message =
      err instanceof RepoFetchError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Scan failed unexpectedly.";

    updateScan(scanId, { status: "failed", error: message });
    setPhase("failed");
    throw new Error(message);
  } finally {
    if (workDir) {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
