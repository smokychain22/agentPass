import { GitHubClient } from "@/lib/github/github-client";
import type { GitHubAccessState } from "./access-states";
import type { GitHubPreflightResult } from "./types";
import {
  createInstallationAccessToken,
  getInstallationDetails,
  installationIncludesRepositoryWithRetry,
} from "./installations";
import { isGitHubAppConfigured } from "./config";
import { readInstallationSession } from "./session";
import { resolveRepoInstallBinding, saveRepoInstallBinding } from "./install-flow-store";
import { isRecentRepoInstallBinding } from "./binding-trust";
import {
  parseRepositoryFullName,
  requiresRepositoryOwnerInstall,
} from "./repository";
import { isPublicGitHubRepository } from "@/lib/github/fetch-repo-zip";

export type { GitHubPreflightResult } from "./types";

export interface GitHubPreflightInput {
  repositoryFullName: string;
  branch?: string;
  scanId?: string;
  commitSha?: string;
  sessionKey?: string;
  /** Fast path for UI — minimal GitHub API retries (sub-second). */
  quick?: boolean;
}

export function resolveGrantPropagationPending(input: {
  bindingTrusted: boolean;
  repositoryAccessible: boolean;
  suspended: boolean;
  repositoryIsPublic: boolean;
  ownerMismatch: boolean;
}): boolean {
  return (
    input.bindingTrusted &&
    !input.repositoryAccessible &&
    !input.suspended &&
    !input.repositoryIsPublic &&
    !input.ownerMismatch
  );
}

/** PR delivery may proceed when GitHub confirms access or a recent grant binding is trusted. */
export function resolveRepositoryAuthorized(input: {
  repositoryAccessible: boolean;
  bindingTrusted: boolean;
  permissionsVerified: boolean;
  suspended: boolean;
}): boolean {
  const deliveryReady = input.repositoryAccessible || input.bindingTrusted;
  return deliveryReady && input.permissionsVerified && !input.suspended;
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
  bindingTrusted: boolean;
  permissionsVerified: boolean;
  suspended: boolean;
}): GitHubAccessState {
  if (!input.configured) return "not_configured";
  if (!input.session) return "not_installed";
  if (input.suspended) return "organization_approval_required";
  if (!input.permissionsVerified) return "permissions_outdated";
  if (!input.repositoryAccessible && !input.bindingTrusted) return "installed_repo_missing";
  return "repository_verified";
}

export async function runGitHubPreflight(
  input: GitHubPreflightInput
): Promise<GitHubPreflightResult> {
  const { owner, repo } = parseRepositoryFullName(input.repositoryFullName);
  const configured = isGitHubAppConfigured();
  const session = configured ? await readInstallationSession() : null;
  const repositoryIsPublic = await isPublicGitHubRepository(owner, repo);

  let repositoryAccessible = false;
  let bindingTrusted = false;
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

    const binding = input.sessionKey
      ? await resolveRepoInstallBinding({
          sessionKey: input.sessionKey,
          installationId: session.installationId,
          repositoryFullName: input.repositoryFullName,
        })
      : await resolveRepoInstallBinding({
          installationId: session.installationId,
          repositoryFullName: input.repositoryFullName,
        });
    bindingTrusted = isRecentRepoInstallBinding(binding, session.installationId);

    const attempts = input.quick ? 2 : bindingTrusted ? 3 : 4;
    const delayMs = input.quick ? 400 : 1000;

    const access = await installationIncludesRepositoryWithRetry(
      session.installationId,
      owner,
      repo,
      { attempts, delayMs }
    );
    repositoryAccessible = access.granted;

    if (!repositoryAccessible && bindingTrusted && !input.quick) {
      const propagated = await installationIncludesRepositoryWithRetry(
        session.installationId,
        owner,
        repo,
        { attempts: 4, delayMs: 1500 }
      );
      repositoryAccessible = propagated.granted;
    }

    const deliveryReady = repositoryAccessible || bindingTrusted;

    if (deliveryReady && permissionsVerified) {
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

      if (input.sessionKey) {
        await saveRepoInstallBinding({
          sessionKey: input.sessionKey,
          installationId: session.installationId,
          installationOwner: installationOwner ?? session.accountLogin,
          installationOwnerType: session.accountType,
          repositoryFullName: input.repositoryFullName,
          setupAction: binding?.setupAction,
          authorizedAt: binding?.authorizedAt ?? new Date().toISOString(),
        });
      }
    }
  }

  const accessState = mapAccessState({
    configured,
    session,
    repositoryAccessible,
    bindingTrusted,
    permissionsVerified,
    suspended,
  });

  const ownerMismatch = requiresRepositoryOwnerInstall({
    repositoryOwner: owner,
    installationOwner,
  });

  const repositoryAuthorized =
    !ownerMismatch &&
    resolveRepositoryAuthorized({
      repositoryAccessible,
      bindingTrusted,
      permissionsVerified,
      suspended,
    });

  const { accessCopyForState } = await import("./access-states");
  const displayState =
    ownerMismatch && !repositoryAccessible && !repositoryIsPublic
      ? ("wrong_account" as const)
      : accessState;
  const messages = accessCopyForState(displayState, repo, owner);

  return {
    githubUserConnected: Boolean(session),
    appInstalled: Boolean(session),
    installationId: session?.installationId,
    installationOwner,
    repositoryOwner: owner,
    requiresRepositoryOwnerInstall: ownerMismatch,
    repositoryIsPublic,
    repositoryAuthorized,
    grantPropagationPending: resolveGrantPropagationPending({
      bindingTrusted,
      repositoryAccessible,
      suspended,
      repositoryIsPublic,
      ownerMismatch,
    }),
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
