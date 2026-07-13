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

export async function resolveRepositoryConnectionStatus(input: {
  repository: string;
  branch?: string;
  commitSha?: string;
  sessionKey?: string;
}): Promise<RepositoryConnectionStatus> {
  const { owner, repo } = parseRepositoryFullName(input.repository);
  const fullName = `${owner}/${repo}`;

  const preflight = await runGitHubPreflight({
    repositoryFullName: fullName,
    branch: input.branch,
    commitSha: input.commitSha,
    sessionKey: input.sessionKey,
    quick: false,
  });

  const connected =
    preflight.appInstalled &&
    preflight.repositoryAuthorized &&
    preflight.permissionsVerified;

  return {
    connected,
    configured: preflight.githubUserConnected || preflight.appInstalled,
    installationId: preflight.installationId,
    repository: fullName,
    owner: preflight.repositoryOwner,
    canRead: preflight.repositoryAccessible || preflight.repositoryIsPublic === true,
    canCreateBranch: preflight.canCreateBranch && connected,
    canCreatePullRequest: preflight.canCreatePullRequest && connected,
    defaultBranch: input.branch,
    commitSha: input.commitSha,
    commitMatches: preflight.commitMatches,
    accessState: preflight.accessState,
    messages: preflight.messages,
  };
}
