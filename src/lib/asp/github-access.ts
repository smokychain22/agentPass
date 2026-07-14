import { ToolExecutionError } from "@/lib/a2mcp/errors";
import { GitHubClient } from "@/lib/github/github-client";
import { isGitHubAppConfigured, getGitHubAppConfig } from "@/lib/github-app/config";
import { createSignedInstallState } from "@/lib/github-app/install-signed-state";
import { buildNewInstallationUrl } from "@/lib/github-app/install-redirect";
import {
  createInstallationAccessToken,
  getInstallationDetails,
  installationHasRepoAccess,
} from "@/lib/github-app/installations";
import { resolveInstallationIdForRepository } from "@/lib/github-app/authoritative-repository-access";
import { getAspPublicBaseUrl } from "./auth";

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

export async function findInstallationForRepository(
  owner: string,
  repo: string,
  installationIdHint?: number
): Promise<number | undefined> {
  if (!isGitHubAppConfigured()) return undefined;

  const resolved = await resolveInstallationIdForRepository({
    owner,
    repo,
    installationIdHint,
  });
  return resolved.installationId;
}

export function buildAspInstallStateToken(input: {
  repositoryFullName: string;
  jobId: string;
}): string {
  const returnPath = `/okx/asp?jobId=${encodeURIComponent(input.jobId)}`;
  return createSignedInstallState({
    repositoryFullName: input.repositoryFullName,
    returnPath,
    ttlMs: 24 * 60 * 60 * 1000,
  });
}

export function buildAspGitHubInstallationUrl(stateToken: string): string {
  const { slug } = getGitHubAppConfig();
  return buildNewInstallationUrl(slug, stateToken);
}

export async function resolveAspGitHubToken(input: {
  owner: string;
  repo: string;
  installationId?: number;
}): Promise<string> {
  const installationId =
    input.installationId ?? (await findInstallationForRepository(input.owner, input.repo));

  if (!installationId) {
    throw new ToolExecutionError(
      "GITHUB_APP_NOT_CONNECTED",
      "Repository-specific GitHub App authorization is required.",
      401
    );
  }

  const details = await getInstallationDetails(installationId);
  if (!permissionsAreSufficient(details?.permissions)) {
    throw new ToolExecutionError(
      "GITHUB_PERMISSION_DENIED",
      "RepoDiet GitHub App needs Contents and Pull requests write access.",
      403
    );
  }

  const hasAccess = await installationHasRepoAccess(installationId, input.owner, input.repo);
  if (!hasAccess) {
    throw new ToolExecutionError(
      "GITHUB_APP_NOT_CONNECTED",
      `RepoDiet is not authorized for ${input.owner}/${input.repo}.`,
      401
    );
  }

  const token = await createInstallationAccessToken(installationId);
  return token.token;
}

export async function captureBaseCommitSha(input: {
  owner: string;
  repo: string;
  branch: string;
  installationId?: number;
}): Promise<string> {
  const token = await resolveAspGitHubToken({
    owner: input.owner,
    repo: input.repo,
    installationId: input.installationId,
  });
  const client = new GitHubClient(token);
  const meta = await client.getRepo(input.owner, input.repo);
  const branch = input.branch || meta.defaultBranch;
  return client.getBranchSha(input.owner, input.repo, branch);
}

export function aspInstallCallbackUrl(jobId: string): string {
  return `${getAspPublicBaseUrl()}/okx/asp?jobId=${encodeURIComponent(jobId)}`;
}
