import { findInstallationForRepository } from "@/lib/asp/github-access";
import { accessCopyForState } from "@/lib/github-app/access-states";
import {
  isRepositoryVerifiedState,
  mapToAuthoritativeAccessState,
  type AuthoritativeGitHubAccessState,
} from "@/lib/github-app/authoritative-access";
import { resolveAuthoritativeRepositoryAccess } from "@/lib/github-app/authoritative-repository-access";
import { isGitHubAppConfigured } from "@/lib/github-app/config";
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
  installationIdLast4?: string;
  checkedAt?: string;
  messages?: {
    title: string;
    body: string;
    primaryAction?: string;
  };
}

function mapAuthoritativeToAccessState(
  state: AuthoritativeGitHubAccessState
): import("@/lib/github-app/access-states").GitHubAccessState {
  switch (state) {
    case "app_not_configured":
      return "not_configured";
    case "installation_required":
    case "installation_not_found_for_app":
    case "token_creation_failed":
    case "installation_error":
      return "not_installed";
    case "account_mismatch":
      return "wrong_account";
    case "repository_not_selected":
      return "installed_repo_missing";
    case "permissions_insufficient":
      return "permissions_outdated";
    case "repository_verified":
      return "repository_verified";
    default:
      return "not_installed";
  }
}

export async function resolveRepositoryConnectionStatus(input: {
  repository: string;
  branch?: string;
  commitSha?: string;
  sessionKey?: string;
  installationIdHint?: number;
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

  const authoritative = await resolveAuthoritativeRepositoryAccess({
    owner,
    repo,
    installationIdHint: input.installationIdHint,
    expectedAccount: owner,
  });

  const accessState = mapAuthoritativeToAccessState(authoritative.authoritativeState);
  const connected =
    isRepositoryVerifiedState(authoritative.authoritativeState) &&
    authoritative.installationTokenAvailable;
  const messages = accessCopyForState(accessState, repo, owner);

  const installationId = authoritative.installationFound
    ? await findInstallationForRepository(owner, repo, input.installationIdHint)
    : undefined;

  return {
    connected,
    configured: true,
    installationId,
    repository: fullName,
    owner,
    canRead: true,
    canCreateBranch: connected,
    canCreatePullRequest: connected,
    defaultBranch: input.branch,
    commitSha: input.commitSha,
    accessState,
    authoritativeState: authoritative.authoritativeState,
    installationTokenAvailable: authoritative.installationTokenAvailable,
    installationIdLast4: authoritative.installationIdLast4,
    checkedAt: authoritative.checkedAt,
    messages,
  };
}
