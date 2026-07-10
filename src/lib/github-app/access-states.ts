export type GitHubAccessState =
  | "not_installed"
  | "installed_repo_missing"
  | "permissions_outdated"
  | "organization_approval_required"
  | "repository_verified"
  | "wrong_account"
  | "state_expired"
  | "repo_not_granted"
  | "not_configured";

export interface GitHubAccessCopy {
  title: string;
  body: string;
  primaryAction?: string;
  secondaryAction?: string;
}

export function accessCopyForState(
  state: GitHubAccessState,
  repoName: string,
  ownerLogin?: string
): GitHubAccessCopy {
  switch (state) {
    case "not_installed":
      return {
        title: "RepoDiet is not installed on this GitHub account",
        body: `Install RepoDiet to open cleanup pull requests for ${repoName}.`,
        primaryAction: "Install RepoDiet",
      };
    case "installed_repo_missing":
      return {
        title: "RepoDiet needs access to this repository",
        body: `GitHub is connected, but ${repoName} was not included when RepoDiet was installed.`,
        primaryAction: `Grant Access to ${repoName}`,
        secondaryAction: "Use a different repository",
      };
    case "permissions_outdated":
      return {
        title: "RepoDiet needs updated GitHub permissions",
        body: "Approve updated permissions so RepoDiet can create cleanup pull requests.",
        primaryAction: "Approve Updated Permissions",
      };
    case "organization_approval_required":
      return {
        title: "Organization approval required",
        body: "Your GitHub organization requires an administrator to approve RepoDiet.",
        primaryAction: "Request Organization Approval",
      };
    case "repository_verified":
      return {
        title: "Repository access verified",
        body: `${repoName} is connected and ready.`,
      };
    case "wrong_account":
      return {
        title: "Install RepoDiet on the repository owner account",
        body: ownerLogin
          ? `This repository belongs to ${ownerLogin}. RepoDiet must be installed by that repository owner.`
          : "RepoDiet must be installed by the GitHub account that owns this repository.",
        primaryAction: ownerLogin ? `Install RepoDiet as ${ownerLogin}` : "Install RepoDiet",
      };
    case "state_expired":
      return {
        title: "Your GitHub connection request expired",
        body: "Start again to grant repository access.",
        primaryAction: "Reconnect GitHub",
      };
    case "repo_not_granted":
      return {
        title: `${repoName} was not granted access`,
        body: "Select this repository on GitHub and save access to continue.",
        primaryAction: "Try Again",
      };
    case "not_configured":
      return {
        title: "GitHub App is not configured",
        body: "This deployment cannot connect to GitHub yet.",
      };
  }
}
