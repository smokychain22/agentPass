import { findInstallationForRepository } from "@/lib/asp/github-access";
import { accessCopyForState } from "@/lib/github-app/access-states";
import {
  isRepositoryVerifiedState,
  mapToAuthoritativeAccessState,
  type AuthoritativeGitHubAccessState,
} from "@/lib/github-app/authoritative-access";
import { isGitHubAppConfigured } from "@/lib/github-app/config";
import {
  createInstallationAccessToken,
  getInstallationDetails,
  installationHasRepoAccess,
} from "@/lib/github-app/installations";
import { parseRepositoryFullName } from "@/lib/github-app/repository";

export interface RepositoryConnectionStatus {
  connected: boolean;
  configured: boolean;
  installationId?: number;
  repository: string;
  owner: string;
  canRead: boolean;
  canCreateBranch: boolean;
  canCreatePullRequest: boolean;
  defaultBranch?: string;
  commitSha?: string;
  commitMatches?: boolean;
  accessState?: string;
  authoritativeState?: AuthoritativeGitHubAccessState;
  installationTokenAvailable?: boolean;
  messages?: {
    title: string;
    body: string;
    primaryAction?: string;
  };
}

function permissionsAreSufficient(permissions?: {
  contents: string;
  pullRequests: string;
  metadata: string;
}): boolean {
  if (!permissions) return false;
  return (
    permissions.contents === "write" &&
    permissions.pullRequests === "write" &&
    (permissions.metadata === "read" || permissions.metadata === "write")
  );
}

async function resolveServerInstallationStatus(input: {
  owner: string;
  repo: string;
}): Promise<{
  connected: boolean;
  installationId?: number;
  accessState: import("@/lib/github-app/access-states").GitHubAccessState;
  installationTokenAvailable: boolean;
}> {
  const installationId = await findInstallationForRepository(input.owner, input.repo);
  if (!installationId) {
    return {
      connected: false,
      accessState: "not_installed",
      installationTokenAvailable: false,
    };
  }

  const details = await getInstallationDetails(installationId);
  if (!details) {
    return {
      connected: false,
      installationId,
      accessState: "not_installed",
      installationTokenAvailable: false,
    };
  }

  if (details.suspendedAt) {
    return {
      connected: false,
      installationId,
      accessState: "organization_approval_required",
      installationTokenAvailable: false,
    };
  }

  if (!permissionsAreSufficient(details.permissions)) {
    return {
      connected: false,
      installationId,
      accessState: "permissions_outdated",
      installationTokenAvailable: false,
    };
  }

  const hasAccess = await installationHasRepoAccess(installationId, input.owner, input.repo);
  if (!hasAccess) {
    return {
      connected: false,
      installationId,
      accessState: "installed_repo_missing",
      installationTokenAvailable: false,
    };
  }

  let installationTokenAvailable = false;
  try {
    await createInstallationAccessToken(installationId);
    installationTokenAvailable = true;
  } catch {
    installationTokenAvailable = false;
  }

  const verified = installationTokenAvailable;

  return {
    connected: verified,
    installationId,
    accessState: verified ? "repository_verified" : "not_installed",
    installationTokenAvailable,
  };
}

export async function resolveRepositoryConnectionStatus(input: {
  repository: string;
  branch?: string;
  commitSha?: string;
  sessionKey?: string;
}): Promise<RepositoryConnectionStatus> {
  const { owner, repo } = parseRepositoryFullName(input.repository);
  const fullName = `${owner}/${repo}`;
  const configured = isGitHubAppConfigured();

  if (!configured) {
    const authoritativeState: AuthoritativeGitHubAccessState = "app_not_configured";
    return {
      connected: false,
      configured: false,
      repository: fullName,
      owner,
      canRead: true,
      canCreateBranch: false,
      canCreatePullRequest: false,
      defaultBranch: input.branch,
      commitSha: input.commitSha,
      accessState: "not_configured",
      authoritativeState,
      installationTokenAvailable: false,
      messages: accessCopyForState("not_configured", repo, owner),
    };
  }

  const serverStatus = await resolveServerInstallationStatus({ owner, repo });
  const authoritativeState = mapToAuthoritativeAccessState(serverStatus.accessState);
  const connected = isRepositoryVerifiedState(authoritativeState) && serverStatus.connected;
  const messages = accessCopyForState(serverStatus.accessState, repo, owner);

  return {
    connected,
    configured: true,
    installationId: serverStatus.installationId,
    repository: fullName,
    owner,
    canRead: true,
    canCreateBranch: connected,
    canCreatePullRequest: connected,
    defaultBranch: input.branch,
    commitSha: input.commitSha,
    accessState: serverStatus.accessState,
    authoritativeState,
    installationTokenAvailable: serverStatus.installationTokenAvailable,
    messages,
  };
}
