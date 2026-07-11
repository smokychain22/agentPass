export type GitHubInstallFlow = "install" | "configure";

export class GitHubAppSlugError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubAppSlugError";
  }
}

const INVALID_PROFILE_URL = /^https:\/\/github\.com\/app(?:\?|$)/;

export function getGitHubAppSlugOrThrow(): string {
  const slug = process.env.GITHUB_APP_SLUG?.trim();
  if (!slug) {
    throw new GitHubAppSlugError("GITHUB_APP_SLUG is not configured.");
  }
  if (!/^[a-z0-9-]+$/i.test(slug)) {
    throw new GitHubAppSlugError("GITHUB_APP_SLUG is invalid.");
  }
  return slug;
}

export function buildNewInstallationUrl(slug: string, state?: string): string {
  const base = `https://github.com/apps/${slug}/installations/new`;
  if (!state) return base;
  return `${base}?state=${encodeURIComponent(state)}`;
}

export function buildConfigureInstallationUrl(slug: string, state?: string): string {
  return buildNewInstallationUrl(slug, state);
}

export function resolveGitHubInstallRedirect(input: {
  slug: string;
  stateToken: string;
  installationId?: number;
  requiresRepositoryOwnerInstall: boolean;
  hasRepositoryAccess: boolean;
}): { url: string; flow: GitHubInstallFlow } {
  if (input.requiresRepositoryOwnerInstall || !input.installationId) {
    return {
      url: buildNewInstallationUrl(input.slug, input.stateToken),
      flow: "install",
    };
  }

  if (!input.hasRepositoryAccess) {
    return {
      url: buildConfigureInstallationUrl(input.slug, input.stateToken),
      flow: "configure",
    };
  }

  return {
    url: buildNewInstallationUrl(input.slug, input.stateToken),
    flow: "install",
  };
}

export function assertValidGitHubInstallRedirectUrl(
  url: string,
  flow: GitHubInstallFlow
): void {
  if (!url.startsWith("https://github.com/")) {
    throw new Error("Install redirect must be an absolute https://github.com URL.");
  }

  if (url === "https://github.com/app" || INVALID_PROFILE_URL.test(url)) {
    throw new Error("Install redirect must not target github.com/app.");
  }

  if (url.includes("github.com/settings/apps/")) {
    throw new Error("Install redirect must not use GitHub developer settings.");
  }

  if (url.startsWith("https://github.com/app?")) {
    throw new Error("Install redirect must not target github.com/app.");
  }

  if (flow === "install") {
    if (!url.startsWith("https://github.com/apps/")) {
      throw new Error("New install URL must begin with https://github.com/apps/.");
    }
    if (!url.includes("/installations/new")) {
      throw new Error("New install URL must include /installations/new.");
    }
    return;
  }

  if (
    !url.startsWith("https://github.com/apps/") ||
    !url.includes("/installations/new")
  ) {
    throw new Error("Configure URL must use the public GitHub App installation flow.");
  }
}

export function installRedirectUrlHasState(url: string, state: string): boolean {
  const parsed = new URL(url);
  return parsed.searchParams.get("state") === state;
}
