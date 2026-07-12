import type { GitHubAccessState } from "./access-states";

export interface GitHubInstallationSession {
  installationId: number;
  accountLogin: string;
  accountType: "User" | "Organization" | string;
  connectedAt: string;
}

export interface GitHubConnectionStatus {
  connected: boolean;
  configured: boolean;
  account?: {
    login: string;
    type: string;
  };
  permissions?: {
    contents: string;
    pullRequests: string;
    metadata: string;
  };
}

export interface GitHubPreflightResult {
  githubUserConnected: boolean;
  appInstalled: boolean;
  installationId?: number;
  installationOwner?: string;
  repositoryOwner: string;
  requiresRepositoryOwnerInstall: boolean;
  /** Public repos can use scan/sandbox without App repo grant. */
  repositoryIsPublic?: boolean;
  repositoryAuthorized: boolean;
  permissionsVerified: boolean;
  repositoryAccessible: boolean;
  canCreateBranch: boolean;
  canCreatePullRequest: boolean;
  branchExists: boolean;
  commitMatches?: boolean;
  accessState: GitHubAccessState;
  repositoryFullName: string;
  branch?: string;
  scanId?: string;
  messages: {
    title: string;
    body: string;
    primaryAction?: string;
    secondaryAction?: string;
  };
  /** User granted access recently; GitHub may still be propagating. */
  grantPropagationPending?: boolean;
  developer?: {
    contentsPermission?: string;
    pullRequestsPermission?: string;
    metadataPermission?: string;
    suspendedAt?: string | null;
  };
}

export interface GitHubPreflightResponse extends GitHubPreflightResult {
  ok: boolean;
}

export interface InstallationTokenResult {
  token: string;
  expiresAt: string;
}
