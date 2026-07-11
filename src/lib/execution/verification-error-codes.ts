/** Normalized verification failure classes for UI and diagnostics. */
export type VerificationFailureCode =
  | "DECLARED_DEPENDENCY_NOT_INSTALLED"
  | "FRAMEWORK_DEPENDENCY_REMOVED"
  | "OPTIONAL_BINARY_MISSING"
  | "NEXT_SWC_BINARY_MISSING"
  | "DEPENDENCY_INSTALL_FAILED"
  | "LOCKFILE_INVALID"
  | "LOCKFILE_MISSING"
  | "BASELINE_BUILD_FAILED"
  | "PATCHED_BUILD_FAILED"
  | "PATCH_REGRESSION"
  | "GIT_CLI_UNAVAILABLE"
  | "GIT_PATCH_INVALID"
  | "NODE_VERSION_UNSUPPORTED"
  | "PACKAGE_MANAGER_UNSUPPORTED"
  | "WORKSPACE_INCOMPLETE"
  | "CHECK_FAILED";

export type RepositoryVerificationOutcome =
  | "verified"
  | "regression_failed"
  | "baseline_blocked"
  | "improved_but_baseline_invalid"
  | "blocked"
  | "failed"
  | "not_run";

export function humanizeVerificationFailure(code: VerificationFailureCode): string {
  switch (code) {
    case "DECLARED_DEPENDENCY_NOT_INSTALLED":
      return "A dependency declared in package.json was not installed.";
    case "NEXT_SWC_BINARY_MISSING":
      return "The Next.js SWC platform binary was omitted during dependency installation.";
    case "OPTIONAL_BINARY_MISSING":
      return "A required optional platform binary was not installed.";
    case "GIT_CLI_UNAVAILABLE":
      return "Git CLI is unavailable in this runtime; patch validation cannot run.";
    case "GIT_PATCH_INVALID":
      return "The cleanup patch did not pass git apply --check.";
    case "PATCH_REGRESSION":
      return "Repository checks passed on the baseline but failed after applying cleanup.";
    case "BASELINE_BUILD_FAILED":
      return "The scanned repository already fails verification before cleanup.";
    case "DEPENDENCY_INSTALL_FAILED":
      return "Dependency installation failed before repository checks could run.";
    default:
      return "Repository verification could not complete.";
  }
}
