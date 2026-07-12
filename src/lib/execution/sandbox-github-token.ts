import { createInstallationAccessToken } from "@/lib/github-app/installations";
import { isGitHubAppConfigured } from "@/lib/github-app/config";
import { readInstallationSession } from "@/lib/github-app/session";
import {
  installationIncludesRepositoryWithRetry,
  getInstallationDetails,
} from "@/lib/github-app/installations";
import { lookupRepositoryInstallationBinding } from "@/lib/github-app/install-flow-store";
import { isPublicGitHubRepository } from "@/lib/github/fetch-repo-zip";
import { getSandboxRun } from "./sandbox-run-store";
import { requiresRepositoryOwnerInstall } from "@/lib/github-app/repository";

export interface FreshGitHubTokenResult {
  token: string;
  expiresAt: string;
  installationId: number;
}

export type SandboxCloneAuth =
  | ({ mode: "installation" } & FreshGitHubTokenResult)
  | { mode: "public" };

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

function formatRepositoryAccessError(input: {
  owner: string;
  repo: string;
  installationOwner?: string;
}): string {
  const fullName = `${input.owner}/${input.repo}`;
  if (
    requiresRepositoryOwnerInstall({
      repositoryOwner: input.owner,
      installationOwner: input.installationOwner,
    })
  ) {
    return `RepoDiet must be installed on the ${input.owner} GitHub account to open pull requests for ${fullName}. Verification can still run on public repositories.`;
  }
  return `RepoDiet needs GitHub App write access to ${fullName} before opening a cleanup pull request.`;
}

async function resolveInstallationId(
  input: {
    repositoryOwner: string;
    repositoryName: string;
    installationId?: number;
  }
): Promise<number> {
  const repositoryFullName = `${input.repositoryOwner}/${input.repositoryName}`;
  let installationId = input.installationId;

  if (!installationId) {
    const binding = await lookupRepositoryInstallationBinding(repositoryFullName);
    installationId = binding?.installationId;
  }

  if (!installationId) {
    const session = await readInstallationSession();
    if (!session?.installationId) {
      throw new Error("GITHUB_APP_NOT_CONNECTED");
    }
    installationId = session.installationId;
  }

  return installationId;
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

  const installationId = await resolveInstallationId(input);

  const details = await getInstallationDetails(installationId);
  if (!permissionsAreSufficient(details?.permissions)) {
    throw new Error("GITHUB_PERMISSION_DENIED");
  }

  const access = await installationIncludesRepositoryWithRetry(
    installationId,
    input.repositoryOwner,
    input.repositoryName,
    { attempts: 6, delayMs: 2000 }
  );

  if (!access.granted) {
    throw new Error(
      formatRepositoryAccessError({
        owner: input.repositoryOwner,
        repo: input.repositoryName,
        installationOwner: details?.accountLogin,
      })
    );
  }

  const result = await createInstallationAccessToken(installationId);
  return {
    token: result.token,
    expiresAt: result.expiresAt,
    installationId,
  };
}

/**
 * Scan uses public ZIP downloads; sandbox git validation must not require App repo
 * access for public repositories that were already scanned successfully.
 */
export async function resolveSandboxCloneAuth(input: {
  repositoryOwner: string;
  repositoryName: string;
  installationId?: number;
  jobId?: string;
}): Promise<SandboxCloneAuth> {
  const isPublic = await isPublicGitHubRepository(
    input.repositoryOwner,
    input.repositoryName
  );
  if (isPublic) {
    return { mode: "public" };
  }

  const token = await createFreshGitHubInstallationToken(input);
  return { mode: "installation", ...token };
}

export function authenticatedCloneUrl(repoUrl: string, token: string): string {
  const trimmed = repoUrl.trim().replace(/\/$/, "");
  if (!trimmed.startsWith("https://github.com/")) {
    throw new Error("UNSUPPORTED_REPOSITORY_URL");
  }
  return trimmed.replace("https://", `https://x-access-token:${token}@`);
}

export function publicGitCloneUrl(repoUrl: string): string {
  const trimmed = repoUrl.trim().replace(/\/$/, "");
  if (!trimmed.startsWith("https://github.com/")) {
    throw new Error("UNSUPPORTED_REPOSITORY_URL");
  }
  return trimmed.endsWith(".git") ? trimmed : `${trimmed}.git`;
}
