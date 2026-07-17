import { parseGitHubUrl } from "@/lib/github/parse-github-url";
import { ACTIONS_ANALYSIS_LIMITS } from "@/lib/github-actions/limits";

export type ArchiveJobLike = {
  repositoryOwner?: string;
  repositoryName?: string;
  branch?: string;
  sourceCommit?: string;
  request: {
    repoUrl: string;
    branch?: string;
    sourceCommit?: string;
  };
};

export type ArchiveDescriptor = {
  url: string | null;
  sourceCommit?: string;
  branch: string;
  maxBytes: number;
  maxFiles: number;
};

/**
 * Public GitHub archive URL for the Actions claim job.
 * Prefer commit-pinned zip when sourceCommit is known; fall back to branch zip.
 * Owner/name come from job fields or are parsed from request.repoUrl.
 */
export function buildArchiveDescriptor(job: ArchiveJobLike): ArchiveDescriptor {
  const parsed = parseGitHubUrl(job.request.repoUrl);
  const owner = job.repositoryOwner?.trim() || parsed?.owner;
  const name = job.repositoryName?.trim() || parsed?.repo;
  const branch = job.branch || job.request.branch || parsed?.branch || "main";
  const sourceCommit = job.sourceCommit || job.request.sourceCommit;

  let url: string | null = null;
  if (owner && name) {
    url = sourceCommit
      ? `https://github.com/${owner}/${name}/archive/${encodeURIComponent(sourceCommit)}.zip`
      : `https://github.com/${owner}/${name}/archive/refs/heads/${encodeURIComponent(branch)}.zip`;
  }

  return {
    url,
    sourceCommit,
    branch,
    maxBytes: ACTIONS_ANALYSIS_LIMITS.maxArchiveBytes,
    maxFiles: ACTIONS_ANALYSIS_LIMITS.maxFiles,
  };
}
