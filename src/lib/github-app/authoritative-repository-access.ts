import { canonicalAppOrigin } from "@/lib/payment/canonical-app-url";
import {
  deleteAspRepositoryInstallation,
  getAspRepositoryInstallation,
  saveAspRepositoryInstallation,
} from "@/lib/asp/store";
import { getGitHubAppConfig, isGitHubAppConfigured } from "@/lib/github-app/config";
import {
  createInstallationAccessToken,
  getInstallationDetails,
  installationIncludesRepository,
  installationIncludesRepositoryWithRetry,
} from "@/lib/github-app/installations";
import { getAppOctokit } from "@/lib/github-app/octokit";
import { lookupRepositoryInstallationBinding } from "@/lib/github-app/install-flow-store";
import { REPO_INSTALL_BINDING_TRUST_MS } from "@/lib/github-app/binding-trust";
import {
  installationIdLastFour,
  type AuthoritativeGitHubAccessState,
} from "@/lib/github-app/authoritative-access";
import { requiresRepositoryOwnerInstall } from "@/lib/github-app/repository";

function isRecentBindingAuthorizedAt(authorizedAt?: string): boolean {
  if (!authorizedAt) return false;
  const parsed = Date.parse(authorizedAt);
  if (!Number.isFinite(parsed)) return false;
  const age = Date.now() - parsed;
  return age >= 0 && age < REPO_INSTALL_BINDING_TRUST_MS;
}

export interface AuthoritativeRepositoryAccessResult {
  authoritativeState: AuthoritativeGitHubAccessState;
  account?: string;
  repository: string;
  installationFound: boolean;
  installationIdLast4?: string;
  repositorySelected: boolean;
  contentsPermission?: string;
  pullRequestsPermission?: string;
  installationTokenAvailable: boolean;
  checkedAt: string;
  canonicalOrigin: string;
  githubAppId?: string;
  diagnosticReason?: string;
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

async function paginateInstallationForRepository(
  owner: string,
  repo: string
): Promise<number | undefined> {
  try {
    const octokit = getAppOctokit();
    const installations = await octokit.paginate(octokit.rest.apps.listInstallations, {
      per_page: 100,
    });

    for (const installation of installations) {
      const installationId = installation.id;
      const details = await getInstallationDetails(installationId);
      if (!permissionsAreSufficient(details?.permissions)) continue;
      if (await installationIncludesRepository(installationId, owner, repo)) {
        return installationId;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export async function resolveInstallationIdForRepository(input: {
  owner: string;
  repo: string;
  installationIdHint?: number;
}): Promise<{ installationId?: number; source?: string }> {
  const repositoryFullName = `${input.owner}/${input.repo}`;

  if (input.installationIdHint) {
    return { installationId: input.installationIdHint, source: "callback_hint" };
  }

  const binding = await lookupRepositoryInstallationBinding(repositoryFullName);
  if (binding?.installationId) {
    return { installationId: binding.installationId, source: "install_binding" };
  }

  const cached = await getAspRepositoryInstallation(repositoryFullName);
  if (cached?.installationId) {
    const hasAccess = await installationIncludesRepository(
      cached.installationId,
      input.owner,
      input.repo
    );
    if (hasAccess) {
      return { installationId: cached.installationId, source: "asp_cache" };
    }
    await deleteAspRepositoryInstallation(repositoryFullName);
  }

  const discovered = await paginateInstallationForRepository(input.owner, input.repo);
  if (discovered) {
    await saveAspRepositoryInstallation({
      installationId: discovered,
      repositoryFullName,
      authorizedAt: new Date().toISOString(),
    });
    return { installationId: discovered, source: "installation_scan" };
  }

  return {};
}

export async function resolveAuthoritativeRepositoryAccess(input: {
  owner: string;
  repo: string;
  installationIdHint?: number;
  expectedAccount?: string;
}): Promise<AuthoritativeRepositoryAccessResult> {
  const repositoryFullName = `${input.owner}/${input.repo}`;
  const checkedAt = new Date().toISOString();
  const canonicalOrigin =
    canonicalAppOrigin() || "https://skillswap-virid-kappa.vercel.app";

  if (!isGitHubAppConfigured()) {
    return {
      authoritativeState: "app_not_configured",
      repository: repositoryFullName,
      installationFound: false,
      repositorySelected: false,
      installationTokenAvailable: false,
      checkedAt,
      canonicalOrigin,
      diagnosticReason: "GitHub App environment variables are not configured.",
    };
  }

  let githubAppId: string | undefined;
  try {
    githubAppId = getGitHubAppConfig().appId;
  } catch {
    return {
      authoritativeState: "app_not_configured",
      repository: repositoryFullName,
      installationFound: false,
      repositorySelected: false,
      installationTokenAvailable: false,
      checkedAt,
      canonicalOrigin,
      diagnosticReason: "GitHub App credentials are incomplete.",
    };
  }

  const resolved = await resolveInstallationIdForRepository({
    owner: input.owner,
    repo: input.repo,
    installationIdHint: input.installationIdHint,
  });

  if (!resolved.installationId) {
    return {
      authoritativeState: "installation_required",
      repository: repositoryFullName,
      installationFound: false,
      repositorySelected: false,
      installationTokenAvailable: false,
      checkedAt,
      canonicalOrigin,
      githubAppId,
      diagnosticReason: "No RepoDiet installation grants access to this repository.",
    };
  }

  const installationId = resolved.installationId;
  const details = await getInstallationDetails(installationId);

  if (!details) {
    return {
      authoritativeState: "installation_not_found_for_app",
      repository: repositoryFullName,
      installationFound: false,
      installationIdLast4: installationIdLastFour(installationId),
      repositorySelected: false,
      installationTokenAvailable: false,
      checkedAt,
      canonicalOrigin,
      githubAppId,
      diagnosticReason:
        "Installation ID is not visible to the RepoDiet GitHub App (wrong app or revoked).",
    };
  }

  const account = details.accountLogin;

  if (
    input.expectedAccount &&
    requiresRepositoryOwnerInstall({
      repositoryOwner: input.owner,
      installationOwner: account,
    })
  ) {
    return {
      authoritativeState: "account_mismatch",
      account,
      repository: repositoryFullName,
      installationFound: true,
      installationIdLast4: installationIdLastFour(installationId),
      repositorySelected: false,
      contentsPermission: details.permissions.contents,
      pullRequestsPermission: details.permissions.pullRequests,
      installationTokenAvailable: false,
      checkedAt,
      canonicalOrigin,
      githubAppId,
      diagnosticReason: `Installation belongs to ${account}, but repository owner is ${input.owner}.`,
    };
  }

  if (details.suspendedAt) {
    return {
      authoritativeState: "permissions_insufficient",
      account,
      repository: repositoryFullName,
      installationFound: true,
      installationIdLast4: installationIdLastFour(installationId),
      repositorySelected: false,
      contentsPermission: details.permissions.contents,
      pullRequestsPermission: details.permissions.pullRequests,
      installationTokenAvailable: false,
      checkedAt,
      canonicalOrigin,
      githubAppId,
      diagnosticReason: "GitHub organization approval is required for this installation.",
    };
  }

  if (!permissionsAreSufficient(details.permissions)) {
    return {
      authoritativeState: "permissions_insufficient",
      account,
      repository: repositoryFullName,
      installationFound: true,
      installationIdLast4: installationIdLastFour(installationId),
      repositorySelected: false,
      contentsPermission: details.permissions.contents,
      pullRequestsPermission: details.permissions.pullRequests,
      installationTokenAvailable: false,
      checkedAt,
      canonicalOrigin,
      githubAppId,
      diagnosticReason: "Contents and Pull requests write permissions are required.",
    };
  }

  const durableBinding = await lookupRepositoryInstallationBinding(repositoryFullName);
  const bindingTrusted =
    durableBinding?.installationId === installationId &&
    isRecentBindingAuthorizedAt(durableBinding.authorizedAt);

  let repositorySelected = false;
  if (details.repositorySelection === "all" && account.toLowerCase() === input.owner.toLowerCase()) {
    repositorySelected = true;
  } else {
    const access = await installationIncludesRepositoryWithRetry(
      installationId,
      input.owner,
      input.repo,
      { attempts: bindingTrusted ? 6 : 2, delayMs: bindingTrusted ? 1500 : 500 }
    );
    repositorySelected = access.granted;
  }

  if (!repositorySelected && bindingTrusted) {
    repositorySelected = true;
  }

  if (!repositorySelected) {
    return {
      authoritativeState: "repository_not_selected",
      account,
      repository: repositoryFullName,
      installationFound: true,
      installationIdLast4: installationIdLastFour(installationId),
      repositorySelected: false,
      contentsPermission: details.permissions.contents,
      pullRequestsPermission: details.permissions.pullRequests,
      installationTokenAvailable: false,
      checkedAt,
      canonicalOrigin,
      githubAppId,
      diagnosticReason: `${repositoryFullName} is not included in the installation repository list.`,
    };
  }

  let installationTokenAvailable = false;
  try {
    await createInstallationAccessToken(installationId);
    installationTokenAvailable = true;
  } catch {
    return {
      authoritativeState: "token_creation_failed",
      account,
      repository: repositoryFullName,
      installationFound: true,
      installationIdLast4: installationIdLastFour(installationId),
      repositorySelected: true,
      contentsPermission: details.permissions.contents,
      pullRequestsPermission: details.permissions.pullRequests,
      installationTokenAvailable: false,
      checkedAt,
      canonicalOrigin,
      githubAppId,
      diagnosticReason: "Could not mint an installation access token for this repository.",
    };
  }

  await saveAspRepositoryInstallation({
    installationId,
    repositoryFullName,
    authorizedAt: checkedAt,
  });

  return {
    authoritativeState: "repository_verified",
    account,
    repository: repositoryFullName,
    installationFound: true,
    installationIdLast4: installationIdLastFour(installationId),
    repositorySelected: true,
    contentsPermission: details.permissions.contents,
    pullRequestsPermission: details.permissions.pullRequests,
    installationTokenAvailable,
    checkedAt,
    canonicalOrigin,
    githubAppId,
  };
}
