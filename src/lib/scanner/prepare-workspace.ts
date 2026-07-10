import fs from "node:fs/promises";
import path from "node:path";
import {
  DEMO_REPO_BRANCH,
  DEMO_REPO_NAME,
  DEMO_REPO_OWNER,
  DEMO_REPO_URL,
  isDemoRepoUrl,
} from "@/lib/demo/constants";
import { getDemoRepoLocalPath } from "@/lib/demo/paths";
import { parseGitHubUrl, buildRepoUrl } from "@/lib/github/parse-github-url";
import { fetchRepoZip, fetchBranchCommitSha, RepoFetchError } from "@/lib/github/fetch-repo-zip";
import { assertZipSize } from "@/lib/a2mcp/limits";
import { unzipRepoToDir } from "@/lib/scanner/unzip-repo";
import { createScanWorkspace, removeWorkspace } from "@/lib/server/workspace";
import type { ScanJobStage } from "@/lib/jobs/types";

export interface RepoInfo {
  owner: string;
  name: string;
  branch: string;
  url: string;
  commitSha?: string;
}

export interface RepoWorkspace {
  rootDir: string;
  workDir: string;
  repo: RepoInfo;
  cleanup: () => Promise<void>;
}

async function prepareFromGithubZip(
  owner: string,
  name: string,
  branchInput: string | undefined,
  url: string,
  onStage?: (stage: ScanJobStage) => void
): Promise<RepoWorkspace> {
  const workspace = await createScanWorkspace("repo");

  try {
    onStage?.("resolving_branch");
    const { buffer, branch } = await fetchRepoZip(owner, name, branchInput);
    onStage?.("downloading_archive");
    assertZipSize(buffer.byteLength);
    const commitSha = (await fetchBranchCommitSha(owner, name, branch)) ?? undefined;

    await fs.writeFile(workspace.archivePath, Buffer.from(buffer));
    onStage?.("extracting_archive");
    const rootDir = await unzipRepoToDir(buffer, workspace.extractPath);

    const repo: RepoInfo = { owner, name, branch, url, commitSha };
    const capturedRoot = workspace.root;
    return {
      rootDir,
      workDir: capturedRoot,
      repo,
      cleanup: async () => {
        await removeWorkspace(capturedRoot).catch(() => {});
      },
    };
  } catch (err) {
    await removeWorkspace(workspace.root).catch(() => {});
    if (err instanceof RepoFetchError) throw err;
    throw err instanceof Error ? err : new Error("Failed to prepare repository workspace.");
  }
}

async function prepareLocalDemoWorkspace(): Promise<RepoWorkspace> {
  const sourceDir = getDemoRepoLocalPath();
  try {
    await fs.access(sourceDir);
  } catch {
    return prepareFromGithubZip(
      DEMO_REPO_OWNER,
      DEMO_REPO_NAME,
      DEMO_REPO_BRANCH,
      DEMO_REPO_URL
    );
  }

  const workspace = await createScanWorkspace("demo");
  const rootDir = path.join(workspace.extractPath, "repo");
  await fs.mkdir(rootDir, { recursive: true });
  await fs.cp(sourceDir, rootDir, { recursive: true });

  const repo: RepoInfo = {
    owner: DEMO_REPO_OWNER,
    name: DEMO_REPO_NAME,
    branch: DEMO_REPO_BRANCH,
    url: DEMO_REPO_URL,
  };

  const capturedRoot = workspace.root;
  return {
    rootDir,
    workDir: capturedRoot,
    repo,
    cleanup: async () => {
      await removeWorkspace(capturedRoot).catch(() => {});
    },
  };
}

export async function prepareRepoWorkspace(
  repoUrl: string,
  branchInput?: string,
  onStage?: (stage: ScanJobStage) => void
): Promise<RepoWorkspace> {
  if (isDemoRepoUrl(repoUrl)) {
    return prepareLocalDemoWorkspace();
  }

  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed) {
    throw new Error(
      "Invalid GitHub URL. Use https://github.com/owner/repo or github.com/owner/repo."
    );
  }

  const branchOverride = branchInput?.trim() || parsed.branch || undefined;

  return prepareFromGithubZip(
    parsed.owner,
    parsed.repo,
    branchOverride,
    buildRepoUrl(parsed.owner, parsed.repo),
    onStage
  );
}
