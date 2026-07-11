import { ToolExecutionError } from "@/lib/a2mcp/errors";
import { isDemoRepoUrl } from "@/lib/demo/constants";
import { GitHubClient } from "@/lib/github/github-client";
import { isRecentRepoInstallBinding } from "@/lib/github-app/binding-trust";
import {
  createInstallationAccessToken,
  installationHasRepoAccess,
  installationIncludesRepositoryWithRetry,
} from "@/lib/github-app/installations";
import { isGitHubAppConfigured } from "@/lib/github-app/config";
import { resolveRepoInstallBinding } from "@/lib/github-app/install-flow-store";
import { readInstallationSession } from "@/lib/github-app/session";
import { requiresRepositoryOwnerInstall } from "@/lib/github-app/repository";

export interface ResolveCleanupGitHubTokenInput {
  demo?: boolean;
  repoUrl: string;
  owner: string;
  repo: string;
  githubToken?: string;
  sessionKey?: string;
}

async function probeRepositoryWithInstallationToken(
  installationId: number,
  owner: string,
  repo: string
): Promise<boolean> {
  try {
    const installationToken = await createInstallationAccessToken(installationId);
    const client = new GitHubClient(installationToken.token);
    await client.getRepo(owner, repo);
    return true;
  } catch {
    return false;
  }
}

async function assertInstallationRepositoryAccess(input: {
  installationId: number;
  owner: string;
  repo: string;
  sessionKey?: string;
  installationOwner?: string;
}): Promise<void> {
  const repositoryFullName = `${input.owner}/${input.repo}`;
  const binding = await resolveRepoInstallBinding({
    sessionKey: input.sessionKey,
    installationId: input.installationId,
    repositoryFullName,
  });
  const bindingTrusted = isRecentRepoInstallBinding(binding, input.installationId);

  const quickAttempts = bindingTrusted ? 4 : 3;
  const quickDelayMs = bindingTrusted ? 800 : 1000;

  for (let attempt = 1; attempt <= quickAttempts; attempt += 1) {
    if (await installationHasRepoAccess(input.installationId, input.owner, input.repo)) {
      return;
    }
    if (attempt < quickAttempts) {
      await new Promise((resolve) => setTimeout(resolve, quickDelayMs));
    }
  }

  const access = await installationIncludesRepositoryWithRetry(
    input.installationId,
    input.owner,
    input.repo,
    {
      attempts: bindingTrusted ? 4 : 3,
      delayMs: bindingTrusted ? 1000 : 1000,
    }
  );

  if (access.granted) return;

  if (await probeRepositoryWithInstallationToken(input.installationId, input.owner, input.repo)) {
    return;
  }

  const ownerMismatch = requiresRepositoryOwnerInstall({
    repositoryOwner: input.owner,
    installationOwner: input.installationOwner,
  });

  if (ownerMismatch && input.installationOwner) {
    throw new ToolExecutionError(
      "GITHUB_PERMISSION_DENIED",
      `RepoDiet is installed on ${input.installationOwner}, but ${repositoryFullName} belongs to ${input.owner}. Install RepoDiet on the ${input.owner} account (or grant this repository during configure) and try again.`,
      403
    );
  }

  const sample = access.accessibleRepos.slice(0, 5).join(", ");
  throw new ToolExecutionError(
    "GITHUB_PERMISSION_DENIED",
    bindingTrusted
      ? `RepoDiet saved your grant for ${repositoryFullName}, but GitHub has not confirmed repository access yet. Open GitHub → Settings → Applications → RepoDiet → Configure, ensure ${repositoryFullName} is selected, click Save, then use “I granted access — sync now” on the Patch tab.`
      : sample
        ? `RepoDiet needs access to ${repositoryFullName}. Grant access from the Patch tab, ensure the repository is selected on GitHub, then try again.`
        : "RepoDiet needs access to this repository. Grant access from the Patch tab and try again.",
    403
  );
}

export async function resolveCleanupGitHubToken(
  opts: ResolveCleanupGitHubTokenInput
): Promise<string> {
  if (opts.demo) {
    if (!isDemoRepoUrl(opts.repoUrl)) {
      throw new ToolExecutionError(
        "DEMO_REPO_ONLY",
        "Demo mode only works with the configured demo repository.",
        403
      );
    }
    const token = process.env.GITHUB_DEMO_TOKEN?.trim();
    if (!token) {
      throw new ToolExecutionError(
        "INTERNAL_ERROR",
        "Demo GitHub token is not configured on the server.",
        500
      );
    }
    return token;
  }

  if (opts.githubToken?.trim()) {
    return opts.githubToken.trim();
  }

  if (!isGitHubAppConfigured()) {
    throw new ToolExecutionError(
      "GITHUB_APP_NOT_CONFIGURED",
      "GitHub App is not configured on this deployment.",
      503
    );
  }

  const session = await readInstallationSession();
  if (!session) {
    throw new ToolExecutionError(
      "GITHUB_APP_NOT_CONNECTED",
      "Grant repository access from the Patch tab before creating a cleanup PR.",
      401
    );
  }

  await assertInstallationRepositoryAccess({
    installationId: session.installationId,
    owner: opts.owner,
    repo: opts.repo,
    sessionKey: opts.sessionKey,
    installationOwner: session.accountLogin,
  });

  const installationToken = await createInstallationAccessToken(session.installationId);
  return installationToken.token;
}
