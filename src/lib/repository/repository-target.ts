import { parseGitHubUrl, buildRepoUrl } from "@/lib/github/parse-github-url";
import {
  fetchBranchCommitSha,
  fetchDefaultBranch,
  isPublicGitHubRepository,
} from "@/lib/github/fetch-repo-zip";
import { fetchGitHubRepositoryIdentity } from "@/lib/github/refresh-repo-identity";

export type RepositoryVisibility = "public" | "private";
export type ArchiveStrategy = "PUBLIC_ARCHIVE" | "GITHUB_APP_ARCHIVE";

export interface RepositoryTarget {
  provider: "github";
  repositoryId?: string;
  repositoryOwner: string;
  repositoryName: string;
  repositoryFullName: string;
  repositoryUrl: string;
  visibility: RepositoryVisibility;
  branch: string;
  sourceCommit: string;
  projectRoot: string;
  githubInstallationId: string | null;
  archiveStrategy: ArchiveStrategy;
  createdAt: string;
}

export type RepositoryTargetInput = {
  repositoryUrl?: string;
  repoUrl?: string;
  owner?: string;
  name?: string;
  branch?: string;
  sourceCommit?: string;
  commitSha?: string;
  projectRoot?: string;
  githubInstallationId?: string | null;
  /** When true, resolve default branch + pin commit via GitHub API. */
  resolveRemote?: boolean;
};

export class RepositoryIdentityIncompleteError extends Error {
  readonly code = "REPOSITORY_IDENTITY_INCOMPLETE" as const;
  readonly retryable = false;
  readonly missingFields: string[];
  readonly taskId?: string;
  readonly requestId?: string;

  constructor(missingFields: string[], opts?: { taskId?: string; requestId?: string; message?: string }) {
    super(
      opts?.message ||
        `Repository identity incomplete. Missing: ${missingFields.join(", ")}`
    );
    this.name = "RepositoryIdentityIncompleteError";
    this.missingFields = missingFields;
    this.taskId = opts?.taskId;
    this.requestId = opts?.requestId;
  }

  toJSON() {
    return {
      code: this.code,
      retryable: this.retryable,
      missingFields: this.missingFields,
      taskId: this.taskId,
      requestId: this.requestId,
      message: this.message,
    };
  }
}

const SHA_RE = /^[0-9a-f]{7,40}$/i;
const OWNER_RE = /^[A-Za-z0-9_.-]+$/;
const NAME_RE = /^[A-Za-z0-9_.-]+$/;

export function isValidSourceCommit(sha: string | undefined | null): boolean {
  return Boolean(sha && SHA_RE.test(sha.trim()));
}

export function requiredRepositoryTargetFields(target: Partial<RepositoryTarget> | null | undefined): string[] {
  const missing: string[] = [];
  if (!target?.repositoryOwner?.trim()) missing.push("repositoryOwner");
  if (!target?.repositoryName?.trim()) missing.push("repositoryName");
  if (!target?.repositoryFullName?.trim()) missing.push("repositoryFullName");
  if (!target?.repositoryUrl?.trim()) missing.push("repositoryUrl");
  if (!target?.branch?.trim()) missing.push("branch");
  if (!isValidSourceCommit(target?.sourceCommit)) missing.push("sourceCommit");
  if (!target?.projectRoot?.trim()) missing.push("projectRoot");
  if (!target?.archiveStrategy) missing.push("archiveStrategy");
  if (!target?.visibility) missing.push("visibility");
  return missing;
}

export function assertRepositoryTargetComplete(
  target: Partial<RepositoryTarget> | null | undefined,
  opts?: { taskId?: string; requestId?: string }
): asserts target is RepositoryTarget {
  const missing = requiredRepositoryTargetFields(target);
  if (missing.length > 0) {
    throw new RepositoryIdentityIncompleteError(missing, opts);
  }
}

/**
 * Parse + normalize a GitHub repository URL into a durable repository target.
 * Optionally resolves default branch, commit pin, visibility, and canonical casing from GitHub.
 */
export async function normalizeRepositoryTarget(
  input: RepositoryTargetInput
): Promise<RepositoryTarget> {
  const rawUrl = (input.repositoryUrl || input.repoUrl || "").trim();
  let owner = input.owner?.trim();
  let name = input.name?.trim();
  let branchFromUrl: string | undefined;

  if (rawUrl) {
    const parsed = parseGitHubUrl(rawUrl);
    if (!parsed) {
      throw new RepositoryIdentityIncompleteError(["repositoryUrl"], {
        message: "Invalid or non-GitHub repository URL.",
      });
    }
    owner = owner || parsed.owner;
    name = name || parsed.repo;
    branchFromUrl = parsed.branch;
  }

  if (!owner || !name || !OWNER_RE.test(owner) || !NAME_RE.test(name)) {
    throw new RepositoryIdentityIncompleteError(
      [!owner ? "repositoryOwner" : "", !name ? "repositoryName" : ""].filter(Boolean)
    );
  }

  let branch = input.branch?.trim() || branchFromUrl || "";
  let sourceCommit = (input.sourceCommit || input.commitSha || "").trim();
  const projectRoot = (input.projectRoot?.trim() || ".") || ".";
  const installationId = input.githubInstallationId?.trim() || null;

  let visibility: RepositoryVisibility = "public";
  let repositoryId: string | undefined;
  let archiveStrategy: ArchiveStrategy = "PUBLIC_ARCHIVE";

  if (input.resolveRemote !== false) {
    try {
      const identity = await fetchGitHubRepositoryIdentity(owner, name);
      if (identity) {
        // Preserve canonical GitHub casing.
        owner = identity.owner;
        name = identity.name;
        repositoryId = identity.id ? String(identity.id) : undefined;
        if (!branch) branch = identity.defaultBranch || "";
      }
    } catch {
      // fall through — visibility / commit may still resolve
    }

    const isPublic = await isPublicGitHubRepository(owner, name);
    visibility = isPublic ? "public" : "private";
    archiveStrategy = isPublic ? "PUBLIC_ARCHIVE" : "GITHUB_APP_ARCHIVE";

    if (!branch) {
      branch = (await fetchDefaultBranch(owner, name)) || "main";
    }

    if (!isValidSourceCommit(sourceCommit)) {
      const sha = await fetchBranchCommitSha(owner, name, branch);
      if (sha) sourceCommit = sha;
    }
  } else {
    if (!branch) branch = "main";
  }

  if (installationId && visibility === "private") {
    archiveStrategy = "GITHUB_APP_ARCHIVE";
  }

  const target: RepositoryTarget = {
    provider: "github",
    repositoryId,
    repositoryOwner: owner,
    repositoryName: name,
    repositoryFullName: `${owner}/${name}`,
    repositoryUrl: buildRepoUrl(owner, name),
    visibility,
    branch,
    sourceCommit,
    projectRoot,
    githubInstallationId: installationId,
    archiveStrategy,
    createdAt: new Date().toISOString(),
  };

  assertRepositoryTargetComplete(target);
  return target;
}

/** Sync helper when owner/name/commit are already known (e.g. from a structure scan). */
export function repositoryTargetFromKnown(input: {
  owner: string;
  name: string;
  branch: string;
  sourceCommit: string;
  projectRoot?: string;
  visibility?: RepositoryVisibility;
  githubInstallationId?: string | null;
  repositoryId?: string;
}): RepositoryTarget {
  const owner = input.owner.trim();
  const name = input.name.trim();
  const target: RepositoryTarget = {
    provider: "github",
    repositoryId: input.repositoryId,
    repositoryOwner: owner,
    repositoryName: name,
    repositoryFullName: `${owner}/${name}`,
    repositoryUrl: buildRepoUrl(owner, name),
    visibility: input.visibility ?? "public",
    branch: input.branch.trim() || "main",
    sourceCommit: input.sourceCommit.trim(),
    projectRoot: input.projectRoot?.trim() || ".",
    githubInstallationId: input.githubInstallationId ?? null,
    archiveStrategy:
      (input.visibility ?? "public") === "private" || input.githubInstallationId
        ? "GITHUB_APP_ARCHIVE"
        : "PUBLIC_ARCHIVE",
    createdAt: new Date().toISOString(),
  };
  assertRepositoryTargetComplete(target);
  return target;
}
