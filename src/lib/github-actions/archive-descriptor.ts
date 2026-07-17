import {
  assertRepositoryTargetComplete,
  isValidSourceCommit,
  type ArchiveStrategy,
  type RepositoryTarget,
} from "@/lib/repository/repository-target";
import { ACTIONS_ANALYSIS_LIMITS } from "@/lib/github-actions/limits";

export type ArchiveJobLike = {
  repositoryTarget?: RepositoryTarget;
  repositoryOwner?: string;
  repositoryName?: string;
  repositoryFullName?: string;
  branch?: string;
  sourceCommit?: string;
  request: {
    repoUrl: string;
    branch?: string;
    sourceCommit?: string;
    githubInstallationId?: string;
  };
};

export type PublicArchiveDescriptor = {
  strategy: "PUBLIC_ARCHIVE";
  repositoryFullName: string;
  sourceCommit: string;
  url: string;
  expiresAt: null;
  branch: string;
  maxBytes: number;
  maxFiles: number;
};

export type PrivateArchiveDescriptor = {
  strategy: "GITHUB_APP_ARCHIVE";
  repositoryFullName: string;
  sourceCommit: string;
  /** Never a downloadable URL — claim job must mint App token server-side. */
  url: null;
  expiresAt: null;
  branch: string;
  maxBytes: number;
  maxFiles: number;
  requiresInstallation: true;
  githubInstallationId: string | null;
};

export type ArchiveDescriptor = PublicArchiveDescriptor | PrivateArchiveDescriptor;

export class ArchivePreparationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ArchivePreparationError";
    this.code = code;
  }
}

function resolveIdentity(job: ArchiveJobLike): {
  owner: string;
  name: string;
  fullName: string;
  branch: string;
  sourceCommit: string;
  strategy: ArchiveStrategy;
  installationId: string | null;
} {
  const target = job.repositoryTarget;
  if (target) {
    assertRepositoryTargetComplete(target);
    return {
      owner: target.repositoryOwner,
      name: target.repositoryName,
      fullName: target.repositoryFullName,
      branch: target.branch,
      sourceCommit: target.sourceCommit,
      strategy: target.archiveStrategy,
      installationId: target.githubInstallationId,
    };
  }

  const owner = job.repositoryOwner?.trim();
  const name = job.repositoryName?.trim();
  const branch = job.branch || job.request.branch || "main";
  const sourceCommit = job.sourceCommit || job.request.sourceCommit || "";
  if (!owner || !name) {
    throw new ArchivePreparationError(
      "REPOSITORY_IDENTITY_INCOMPLETE",
      "Missing repositoryOwner/repositoryName on durable job."
    );
  }
  if (!isValidSourceCommit(sourceCommit)) {
    throw new ArchivePreparationError(
      "REPOSITORY_IDENTITY_INCOMPLETE",
      "Missing or invalid sourceCommit on durable job."
    );
  }
  return {
    owner,
    name,
    fullName: job.repositoryFullName || `${owner}/${name}`,
    branch,
    sourceCommit,
    strategy: "PUBLIC_ARCHIVE",
    installationId: job.request.githubInstallationId?.trim() || null,
  };
}

/**
 * Build a public commit-pinned archive descriptor.
 * Never silently returns url:null for PUBLIC_ARCHIVE — throws ArchivePreparationError instead.
 */
export function buildArchiveDescriptor(job: ArchiveJobLike): ArchiveDescriptor {
  const id = resolveIdentity(job);

  if (id.strategy === "GITHUB_APP_ARCHIVE") {
    return {
      strategy: "GITHUB_APP_ARCHIVE",
      repositoryFullName: id.fullName,
      sourceCommit: id.sourceCommit,
      url: null,
      expiresAt: null,
      branch: id.branch,
      maxBytes: ACTIONS_ANALYSIS_LIMITS.maxArchiveBytes,
      maxFiles: ACTIONS_ANALYSIS_LIMITS.maxFiles,
      requiresInstallation: true,
      githubInstallationId: id.installationId,
    };
  }

  // Reject branch-name substitution after commit pinning — always commit zip.
  const url = `https://github.com/${id.owner}/${id.name}/archive/${encodeURIComponent(id.sourceCommit)}.zip`;

  return {
    strategy: "PUBLIC_ARCHIVE",
    repositoryFullName: id.fullName,
    sourceCommit: id.sourceCommit,
    url,
    expiresAt: null,
    branch: id.branch,
    maxBytes: ACTIONS_ANALYSIS_LIMITS.maxArchiveBytes,
    maxFiles: ACTIONS_ANALYSIS_LIMITS.maxFiles,
  };
}
