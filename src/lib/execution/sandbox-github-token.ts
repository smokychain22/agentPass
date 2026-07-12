import { createInstallationAccessToken } from "@/lib/github-app/installations";
import { isGitHubAppConfigured } from "@/lib/github-app/config";
import { readInstallationSession } from "@/lib/github-app/session";
import {
  installationHasRepoAccess,
  getInstallationDetails,
} from "@/lib/github-app/installations";
import { getSandboxRun } from "./sandbox-run-store";

export interface FreshGitHubTokenResult {
  token: string;
  expiresAt: string;
  installationId: number;
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

export async function createFreshGitHubInstallationToken(input: {
  repositoryOwner: string;
  repositoryName: string;
  installationId?: number;
  jobId?: string;
}): Promise<FreshGitHubTokenResult> {
  if (!isGitHubAppConfigured()) {
    throw new Error("GITHUB_APP_NOT_CONFIGURED");
  }

  if (input.jobId) {
    const run = await getSandboxRun(input.jobId);
    if (!run) {
      throw new Error("JOB_NOT_FOUND");
    }
    if (
      run.repositoryOwner !== input.repositoryOwner ||
      run.repositoryName !== input.repositoryName
    ) {
      throw new Error("JOB_REPOSITORY_MISMATCH");
    }
  }

  const session = await readInstallationSession();
  const installationId = input.installationId ?? session?.installationId;
  if (!installationId) {
    throw new Error("GITHUB_APP_NOT_CONNECTED");
  }

  const details = await getInstallationDetails(installationId);
  if (!permissionsAreSufficient(details?.permissions)) {
    throw new Error("GITHUB_PERMISSION_DENIED");
  }

  const hasAccess = await installationHasRepoAccess(
    installationId,
    input.repositoryOwner,
    input.repositoryName
  );
  if (!hasAccess) {
    throw new Error("GITHUB_REPOSITORY_NOT_GRANTED");
  }

  const result = await createInstallationAccessToken(installationId);
  return {
    token: result.token,
    expiresAt: result.expiresAt,
    installationId,
  };
}

export function authenticatedCloneUrl(repoUrl: string, token: string): string {
  const trimmed = repoUrl.trim().replace(/\/$/, "");
  if (!trimmed.startsWith("https://github.com/")) {
    throw new Error("UNSUPPORTED_REPOSITORY_URL");
  }
  return trimmed.replace("https://", `https://x-access-token:${token}@`);
}
