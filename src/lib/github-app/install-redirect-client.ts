export type GitHubInstallFlow = "install" | "configure";

function isInvalidGitHubProfileUrl(url: string): boolean {
  return url === "https://github.com/app" || /^https:\/\/github\.com\/app(?:\?|$)/.test(url);
}

function isValidInstallUrl(url: string): boolean {
  return (
    url.startsWith("https://github.com/apps/") &&
    url.includes("/installations/new") &&
    !url.includes("github.com/settings/apps/")
  );
}

function isValidConfigureUrl(url: string): boolean {
  return url.startsWith("https://github.com/settings/installations/");
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

  if (isInvalidGitHubProfileUrl(url)) {
    throw new Error("Invalid GitHub installation URL. Refusing github.com/app redirect.");
  }

  if (url.startsWith("https://github.com/app?")) {
    throw new Error("Invalid GitHub installation URL. Refusing github.com/app redirect.");
  }

  if (flow === "configure") {
    if (!isValidConfigureUrl(url)) {
      throw new Error("Invalid GitHub configuration URL.");
    }
    return;
  }

  if (flow === "install") {
    if (!isValidInstallUrl(url)) {
      throw new Error("Invalid GitHub installation URL.");
    }
    return;
  }

  if (!isValidInstallUrl(url) && !isValidConfigureUrl(url)) {
    throw new Error("Invalid GitHub installation URL.");
  }
}
