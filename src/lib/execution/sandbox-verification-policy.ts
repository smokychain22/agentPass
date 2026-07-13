/**
 * Sandbox verification policy — matches local repository-verification.phasePassed.
 *
 * Required for safe PR delivery: typecheck + build (when present).
 * Advisory only: lint + test (repos often have pre-existing lint debt).
 */

export const REQUIRED_SANDBOX_SCRIPTS = ["typecheck", "build"] as const;
export const ADVISORY_SANDBOX_SCRIPTS = ["lint", "test"] as const;

export type SandboxScriptCheck = {
  name: string;
  exitCode: number;
  stderr: string;
};

export function sandboxPhasePassed(checks: SandboxScriptCheck[]): boolean {
  const executed = checks.filter((c) => Number.isFinite(c.exitCode));
  const required = executed.filter((c) =>
    (REQUIRED_SANDBOX_SCRIPTS as readonly string[]).includes(c.name)
  );
  if (required.length === 0) {
    // No typecheck/build → any failure blocks (including lint-only repos).
    return executed.every((c) => c.exitCode === 0);
  }
  return required.every((c) => c.exitCode === 0);
}

export function firstRequiredFailure(
  checks: SandboxScriptCheck[]
): SandboxScriptCheck | undefined {
  const required = checks.filter((c) =>
    (REQUIRED_SANDBOX_SCRIPTS as readonly string[]).includes(c.name)
  );
  if (required.length > 0) {
    return required.find((c) => c.exitCode !== 0);
  }
  return checks.find((c) => c.exitCode !== 0);
}

export function firstAdvisoryFailure(
  checks: SandboxScriptCheck[]
): SandboxScriptCheck | undefined {
  return checks.find(
    (c) =>
      (ADVISORY_SANDBOX_SCRIPTS as readonly string[]).includes(c.name) &&
      c.exitCode !== 0
  );
}

export function resolveSandboxVerificationOutcome(input: {
  baselineInstallExit: number;
  baselineChecks: SandboxScriptCheck[];
  patchedInstallExit: number;
  patchedChecks: SandboxScriptCheck[];
}): {
  status:
    | "verified"
    | "blocked"
    | "failed"
    | "baseline_blocked"
    | "regression_failed"
    | "improved_but_baseline_invalid";
  failureCode?: string;
  error?: string;
} {
  if (input.baselineInstallExit !== 0) {
    return {
      status: "baseline_blocked",
      failureCode: "DEPENDENCY_INSTALL_FAILED",
      error: "baseline dependency installation failed in sandbox.",
    };
  }
  if (input.patchedInstallExit !== 0) {
    return {
      status: "blocked",
      failureCode: "DEPENDENCY_INSTALL_FAILED",
      error: "patched dependency installation failed in sandbox.",
    };
  }

  const baselineOk = sandboxPhasePassed(input.baselineChecks);
  const patchedOk = sandboxPhasePassed(input.patchedChecks);

  if (baselineOk && patchedOk) {
    return { status: "verified" };
  }

  if (baselineOk && !patchedOk) {
    const failed = firstRequiredFailure(input.patchedChecks) ?? firstAdvisoryFailure(input.patchedChecks);
    return {
      status: "regression_failed",
      failureCode: "PATCH_REGRESSION",
      error: failed
        ? `patched ${failed.name} failed in sandbox.`
        : "Repository verification failed after cleanup.",
    };
  }

  if (!baselineOk && !patchedOk) {
    const baselineFailed = firstRequiredFailure(input.baselineChecks);
    const patchedFailed = firstRequiredFailure(input.patchedChecks);
    if (
      baselineFailed &&
      patchedFailed &&
      baselineFailed.name === patchedFailed.name
    ) {
      return {
        status: "baseline_blocked",
        failureCode: "BASELINE_BUILD_FAILED",
        error: `Baseline repository already fails ${baselineFailed.name} in sandbox.`,
      };
    }
    return {
      status: "regression_failed",
      failureCode: "PATCH_REGRESSION",
      error: patchedFailed
        ? `patched ${patchedFailed.name} failed in sandbox.`
        : "Repository verification failed after cleanup.",
    };
  }

  // patchedOk && !baselineOk — cleanup did not worsen required checks
  return {
    status: "verified",
    error: undefined,
  };
}
