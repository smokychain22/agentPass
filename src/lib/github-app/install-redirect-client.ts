export type GitHubInstallFlow = "install" | "configure";

function isInvalidGitHubProfileUrl(url: string): boolean {
  return url === "https://github.com/app" || /^https:\/\/github\.com\/app(?:\?|$)/.test(url);
}

export function isValidPublicGitHubInstallUrl(url: string): boolean {
  return (
    url.startsWith("https://github.com/apps/") &&
    url.includes("/installations/new") &&
    !url.includes("github.com/settings/apps/")
  );
}

export function assertClientGitHubInstallRedirectUrl(
  url: string,
  flow?: GitHubInstallFlow
): void {
  if (!url || typeof url !== "string") {
    throw new Error("GitHub installation URL is missing.");
  }

  if (!url.startsWith("https://github.com/")) {
    throw new Error(
      "Invalid GitHub installation URL. Expected an absolute https://github.com URL."
    );
  }

  if (isInvalidGitHubProfileUrl(url) || url.startsWith("https://github.com/app?")) {
    throw new Error("Invalid GitHub installation URL. Refusing github.com/app redirect.");
  }

  // Configure and install flows both use the public installations/new URL.
  if (flow === "configure" || flow === "install") {
    if (!isValidPublicGitHubInstallUrl(url)) {
      throw new Error(
        flow === "configure"
          ? "Invalid GitHub configuration URL."
          : "Invalid GitHub installation URL."
      );
    }
    return;
  }

  if (!isValidPublicGitHubInstallUrl(url)) {
    throw new Error("Invalid GitHub installation URL.");
  }
}
