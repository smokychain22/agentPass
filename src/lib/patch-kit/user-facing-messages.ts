import type { PatchKitPayload } from "./types";

/** Plain-language status for Fix & PR — no run ids, SHAs, or JSON dumps. */
export function userFacingSandboxProgress(progress?: string | null): string | null {
  if (!progress?.trim()) return null;
  const p = progress.toLowerCase();
  if (p.includes("preparing") || p.includes("creating")) return "Preparing isolated verification environment…";
  if (p.includes("fetch") || p.includes("clon")) return "Downloading the scanned commit…";
  if (p.includes("baseline")) return "Checking repository dependencies…";
  if (p.includes("applying") || p.includes("operation")) return "Applying cleanup changes…";
  if (p.includes("generating") || p.includes("patch")) return "Building Git patch…";
  if (p.includes("git") || p.includes("validation")) return "Validating patch with Git…";
  if (p.includes("patched") || p.includes("verification")) return "Running post-cleanup checks…";
  if (p.includes("dispatch")) return "Starting verification…";
  return "Running verification…";
}

export function userFacingPatchFailure(patchKit: PatchKitPayload | null | undefined): string {
  const patch = patchKit?.patchValidation;
  const verification = patchKit?.repositoryVerification;

  if (verification?.status === "blocked" || verification?.status === "baseline_blocked") {
    if (verification.error?.toLowerCase().includes("lint")) {
      return "The scanned commit already fails lint. Lint is advisory for cleanup delivery when build/typecheck pass. Retry after the latest deploy.";
    }
    if (patch?.status === "passed") {
      return "Git validation passed, but required repository checks (build/typecheck or dependency install) could not finish in the sandbox. Retry cleanup, or continue with report-only artifacts.";
    }
    if (verification.error?.toLowerCase().includes("dependency") || verification.error?.toLowerCase().includes("install")) {
      return "Dependency installation failed during verification. Click Regenerate Quick Cleanup to retry.";
    }
  }

  if (verification?.status === "failed" && verification.error) {
    return verification.error;
  }

  const failureCode = patch?.gitPatchValidation?.failureCode;
  if (failureCode === "GITHUB_REPOSITORY_NOT_GRANTED") {
    return (
      patch?.userMessage?.replace(/^GITHUB_REPOSITORY_NOT_GRANTED:\s*/, "") ??
      "Grant GitHub App access in RepoDiet Operator, sync, then Regenerate Quick Cleanup."
    );
  }
  if (failureCode === "SANDBOX_UNAVAILABLE") {
    return "Verification sandbox is unavailable on this deployment. Try again after the latest deploy finishes.";
  }

  if (patch?.status === "pending_sandbox") {
    return patchKit?.repositoryIsPublic
      ? "Validating cleanup changes on this public repository (no extra GitHub grant needed)."
      : "Validating cleanup changes in an isolated environment.";
  }

  if (patch?.failingPath) {
    return `Cleanup changes could not be applied to ${patch.failingPath}. Click Regenerate Quick Cleanup to retry.`;
  }

  return "Cleanup changes could not be verified against the scanned commit. Click Regenerate Quick Cleanup to retry.";
}

export function userFacingSandboxBanner(patchKit: PatchKitPayload | null | undefined, progress?: string | null): string | null {
  if (!patchKit) return null;
  if (patchKit.patchValidation?.status === "pending_sandbox") {
    const friendly = userFacingSandboxProgress(progress);
    return friendly ?? "Validating cleanup changes in an isolated environment.";
  }
  return null;
}

export function showPatchKitDeveloperTools(searchParams: URLSearchParams | null): boolean {
  if (process.env.NODE_ENV === "development") return true;
  return searchParams?.get("dev") === "1" || searchParams?.get("developer") === "1";
}
