import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseGitHubUrl, buildRepoUrl } from "@/lib/github/parse-github-url";
import { fetchRepoZip, RepoFetchError } from "@/lib/github/fetch-repo-zip";
import { assertZipSize } from "@/lib/a2mcp/limits";
import { unzipRepoToDir } from "@/lib/scanner/unzip-repo";

export interface RepoInfo {
  owner: string;
  name: string;
  branch: string;
  url: string;
}

export interface RepoWorkspace {
  rootDir: string;
  workDir: string;
  repo: RepoInfo;
  cleanup: () => Promise<void>;
}

export async function prepareRepoWorkspace(
  repoUrl: string,
  branchInput?: string
): Promise<RepoWorkspace> {
  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed) {
    throw new Error(
      "Invalid GitHub URL. Use https://github.com/owner/repo or github.com/owner/repo."
    );
  }

  const branchOverride = branchInput?.trim() || parsed.branch || undefined;

  let workDir: string | null = null;

  try {
    const { buffer, branch } = await fetchRepoZip(
      parsed.owner,
      parsed.repo,
      branchOverride
    );
    assertZipSize(buffer.byteLength);

    workDir = path.join(os.tmpdir(), `repodiet-${randomUUID()}`);
    await fs.mkdir(workDir, { recursive: true });
    const rootDir = await unzipRepoToDir(buffer, workDir);

    const repo: RepoInfo = {
      owner: parsed.owner,
      name: parsed.repo,
      branch,
      url: buildRepoUrl(parsed.owner, parsed.repo),
    };

    const capturedWorkDir = workDir;
    return {
      rootDir,
      workDir: capturedWorkDir,
      repo,
      cleanup: async () => {
        if (capturedWorkDir) {
          await fs.rm(capturedWorkDir, { recursive: true, force: true }).catch(() => {});
        }
      },
    };
  } catch (err) {
    if (workDir) {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
    if (err instanceof RepoFetchError) throw err;
    throw err instanceof Error ? err : new Error("Failed to prepare repository workspace.");
  }
}
