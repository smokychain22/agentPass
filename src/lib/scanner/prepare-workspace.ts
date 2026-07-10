import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  DEMO_REPO_BRANCH,
  DEMO_REPO_NAME,
  DEMO_REPO_OWNER,
  DEMO_REPO_URL,
  isDemoRepoUrl,
} from "@/lib/demo/constants";
import { getDemoRepoLocalPath } from "@/lib/demo/paths";
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

async function prepareFromGithubZip(
  owner: string,
  name: string,
  branchInput: string | undefined,
  url: string
): Promise<RepoWorkspace> {
  let workDir: string | null = null;
  try {
    const { buffer, branch } = await fetchRepoZip(owner, name, branchInput);
    assertZipSize(buffer.byteLength);

    workDir = path.join(os.tmpdir(), `repodiet-${randomUUID()}`);
    await fs.mkdir(workDir, { recursive: true });
    const rootDir = await unzipRepoToDir(buffer, workDir);

    const repo: RepoInfo = { owner, name, branch, url };
    const capturedWorkDir = workDir;
    return {
      rootDir,
      workDir: capturedWorkDir,
      repo,
      cleanup: async () => {
        await fs.rm(capturedWorkDir, { recursive: true, force: true }).catch(() => {});
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

async function prepareLocalDemoWorkspace(): Promise<RepoWorkspace> {
  const sourceDir = getDemoRepoLocalPath();
  try {
    await fs.access(sourceDir);
  } catch {
    // On Vercel the seeded demo folder may be absent — fetch public demo repo from GitHub.
    return prepareFromGithubZip(
      DEMO_REPO_OWNER,
      DEMO_REPO_NAME,
      DEMO_REPO_BRANCH,
      DEMO_REPO_URL
    );
  }

  const workDir = path.join(os.tmpdir(), `repodiet-${randomUUID()}`);
  const rootDir = path.join(workDir, "repo");
  await fs.mkdir(rootDir, { recursive: true });
  await fs.cp(sourceDir, rootDir, { recursive: true });

  const repo: RepoInfo = {
    owner: DEMO_REPO_OWNER,
    name: DEMO_REPO_NAME,
    branch: DEMO_REPO_BRANCH,
    url: DEMO_REPO_URL,
  };

  const capturedWorkDir = workDir;
  return {
    rootDir,
    workDir: capturedWorkDir,
    repo,
    cleanup: async () => {
      await fs.rm(capturedWorkDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

export async function prepareRepoWorkspace(
  repoUrl: string,
  branchInput?: string
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
    buildRepoUrl(parsed.owner, parsed.repo)
  );
}
