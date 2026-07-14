import type { GitHubAccessState } from "./access-states";

export type AuthoritativeGitHubAccessState =
  | "app_not_configured"
  | "installation_required"
  | "repository_not_selected"
  | "permissions_insufficient"
  | "repository_verified"
  | "installation_error";

export function mapToAuthoritativeAccessState(
  state: GitHubAccessState | undefined
): AuthoritativeGitHubAccessState {
  switch (state) {
    case "not_configured":
      return "app_not_configured";
    case "not_installed":
      return "installation_required";
    case "installed_repo_missing":
    case "repo_not_granted":
      return "repository_not_selected";
    case "permissions_outdated":
    case "organization_approval_required":
      return "permissions_insufficient";
    case "repository_verified":
      return "repository_verified";
    case "wrong_account":
    case "state_expired":
    default:
      return "installation_error";
  }
}

export function isRepositoryVerifiedState(state: AuthoritativeGitHubAccessState): boolean {
  return state === "repository_verified";
}
