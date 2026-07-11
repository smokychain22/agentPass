import { GitHubClient } from "@/lib/github/github-client";
import type { GitHubAccessState } from "./access-states";
import type { GitHubPreflightResult } from "./types";
import {
  createInstallationAccessToken,
  getInstallationDetails,
  installationIncludesRepository,
  installationIncludesRepositoryWithRetry,
} from "./installations";
import { isGitHubAppConfigured } from "./config";
import { readInstallationSession } from "./session";
import { readRepoInstallBinding } from "./install-flow-store";
import {
  parseRepositoryFullName,
  requiresRepositoryOwnerInstall,
} from "./repository";

export type { GitHubPreflightResult } from "./types";

export interface GitHubPreflightInput {
  repositoryFullName: string;
  branch?: string;
  scanId?: string;
  commitSha?: string;
  sessionKey?: string;
}

function permissionsAreSufficient(permissions?: {
  contents: string;
  pullRequests: string;
  metadata: string;
}): boolean {
  if (!permissions) return false;
  const contentsOk = permissions.contents === "write";
  const prOk = permissions.pullRequests === "write";
  const metadataOk = permissions.metadata === "read" || permissions.metadata === "write";
  return contentsOk && prOk && metadataOk;
}

function mapAccessState(input: {
  configured: boolean;
  session: Awaited<ReturnType<typeof readInstallationSession>>;
  repositoryAccessible: boolean;
  permissionsVerified: boolean;
  owner: string;
  installationOwner?: string;
  suspended: boolean;
}): GitHubAccessState {
  if (!input.configured) return "not_configured";
  if (!input.session) return "not_installed";
  if (input.suspended) return "organization_approval_required";
  if (
    input.installationOwner &&
    input.installationOwner.toLowerCase() !== input.owner.toLowerCase()
  ) {
    return "wrong_account";
  }
  if (!input.permissionsVerified) return "permissions_outdated";
  if (!input.repositoryAccessible) return "installed_repo_missing";
  return "repository_verified";
}

export async function runGitHubPreflight(
  input: GitHubPreflightInput
): Promise<GitHubPreflightResult> {
  const { owner, repo } = parseRepositoryFullName(input.repositoryFullName);
  const configured = isGitHubAppConfigured();
  const session = configured ? await readInstallationSession() : null;

  let repositoryAccessible = false;
  let permissionsVerified = false;
  let branchExists = false;
  let canCreateBranch = false;
  let canCreatePullRequest = false;
  let commitMatches: boolean | undefined;
  let installationOwner: string | undefined;
  let suspended = false;
  let developer: GitHubPreflightResult["developer"];

  if (session) {
    const details = await getInstallationDetails(session.installationId);
    installationOwner = details?.accountLogin ?? session.accountLogin;
    suspended = Boolean(details?.suspendedAt);
    developer = {
      contentsPermission: details?.permissions.contents,
      pullRequestsPermission: details?.permissions.pullRequests,
      metadataPermission: details?.permissions.metadata,
      suspendedAt: details?.suspendedAt,
    };
    permissionsVerified = permissionsAreSufficient(details?.permissions);
    repositoryAccessible = await installationIncludesRepository(
      session.installationId,
      owner,
      repo
    );

    if (!repositoryAccessible && session) {
      const retried = await installationIncludesRepositoryWithRetry(
        session.installationId,
        owner,
        repo,
        { attempts: 3, delayMs: 1000 }
      );
      repositoryAccessible = retried.granted;
    }

    if (repositoryAccessible && permissionsVerified) {
      // Write contents + pull_requests permissions are sufficient to open cleanup PRs.
      // Branch probe failures (stale scan branch, transient API errors) must not block delivery.
      canCreateBranch = true;
      canCreatePullRequest = true;

      try {
        const token = await createInstallationAccessToken(session.installationId);
        const client = new GitHubClient(token.token);
        const defaultBranch = (await client.getRepo(owner, repo)).defaultBranch;
        const requestedBranch = input.branch?.trim();
        const branchesToTry = [...new Set([requestedBranch, defaultBranch].filter(Boolean))] as string[];

        for (const branch of branchesToTry) {
          try {
            const sha = await client.getBranchSha(owner, repo, branch);
            branchExists = true;
            if (input.commitSha) {
              commitMatches = sha === input.commitSha || sha.startsWith(input.commitSha);
            }
            break;
          } catch {
            // Try default branch next when the scanned branch is missing or renamed.
          }
        }
      } catch {
        branchExists = false;
      }
    }
  }

  if (input.sessionKey) {
    const binding = await readRepoInstallBinding(input.sessionKey, input.repositoryFullName);
    if (binding && session && binding.installationId === session.installationId) {
      repositoryAccessible = repositoryAccessible || true;
    }
  }

  const accessState = mapAccessState({
    configured,
    session,
    repositoryAccessible,
    permissionsVerified,
    owner,
    installationOwner,
    suspended,
  });

  const ownerMismatch = requiresRepositoryOwnerInstall({
    repositoryOwner: owner,
    installationOwner,
  });

  const { accessCopyForState } = await import("./access-states");
  const messages = accessCopyForState(accessState, repo, owner);

  return {
    githubUserConnected: Boolean(session),
    appInstalled: Boolean(session),
    installationId: session?.installationId,
    installationOwner,
    repositoryOwner: owner,
    requiresRepositoryOwnerInstall: ownerMismatch,
    repositoryAuthorized: repositoryAccessible && permissionsVerified && !suspended,
    permissionsVerified,
    repositoryAccessible,
    canCreateBranch,
    canCreatePullRequest,
    branchExists,
    commitMatches,
    accessState,
    repositoryFullName: input.repositoryFullName,
    branch: input.branch,
    scanId: input.scanId,
    messages,
    developer,
  };
}
