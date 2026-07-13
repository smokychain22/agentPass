import { findInstallationForRepository } from "@/lib/asp/github-access";
import { accessCopyForState } from "@/lib/github-app/access-states";
import { isGitHubAppConfigured } from "@/lib/github-app/config";
import {
  getInstallationDetails,
  installationHasRepoAccess,
} from "@/lib/github-app/installations";
import { runGitHubPreflight } from "@/lib/github-app/preflight";
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
}> {
  const installationId = await findInstallationForRepository(input.owner, input.repo);
  if (!installationId) {
    return { connected: false, accessState: "not_installed" };
  }

  const details = await getInstallationDetails(installationId);
  if (!details) {
    return { connected: false, installationId, accessState: "not_installed" };
  }

  if (details.suspendedAt) {
    return {
      connected: false,
      installationId,
      accessState: "organization_approval_required",
    };
  }

  if (!permissionsAreSufficient(details.permissions)) {
    return {
      connected: false,
      installationId,
      accessState: "permissions_outdated",
    };
  }

  const hasAccess = await installationHasRepoAccess(installationId, input.owner, input.repo);
  if (!hasAccess) {
    return {
      connected: false,
      installationId,
      accessState: "installed_repo_missing",
    };
  }

  return {
    connected: true,
    installationId,
    accessState: "repository_verified",
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

  const preflight = await runGitHubPreflight({
    repositoryFullName: fullName,
    branch: input.branch,
    commitSha: input.commitSha,
    sessionKey: input.sessionKey,
    quick: false,
  });

  let connected =
    preflight.appInstalled &&
    preflight.repositoryAuthorized &&
    preflight.permissionsVerified;
  let installationId = preflight.installationId;
  let accessState = preflight.accessState;
  let messages = preflight.messages;

  if (!connected && configured) {
    const serverStatus = await resolveServerInstallationStatus({ owner, repo });
    if (serverStatus.connected) {
      connected = true;
      installationId = serverStatus.installationId;
      accessState = serverStatus.accessState;
      messages = accessCopyForState(serverStatus.accessState, repo, owner);
    } else if (!preflight.appInstalled) {
      installationId = serverStatus.installationId ?? installationId;
      accessState = serverStatus.accessState;
      messages = accessCopyForState(serverStatus.accessState, repo, owner);
    }
  }

  if (!configured) {
    accessState = "not_configured";
    messages = accessCopyForState("not_configured", repo, owner);
  }

  return {
    connected,
    configured,
    installationId,
    repository: fullName,
    owner: preflight.repositoryOwner,
    canRead: preflight.repositoryAccessible || preflight.repositoryIsPublic === true,
    canCreateBranch: connected,
    canCreatePullRequest: connected,
    defaultBranch: input.branch,
    commitSha: input.commitSha,
    commitMatches: preflight.commitMatches,
    accessState,
    messages,
  };
}
