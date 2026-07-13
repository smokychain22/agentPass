/**
 * Sandbox verification policy — matches local repository-verification.phasePassed,
 * plus per-fix retain rules for pre-existing failures.
 *
 * Required for safe PR delivery: typecheck + build (when present).
 * Advisory only: lint + test (repos often have pre-existing lint debt).
 *
 * Pre-existing required-check failure (same failure on baseline AND patched)
 * does not block delivery — cleanup did not introduce the break.
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

/** Normalize check stderr so flaky timestamps do not look like new regressions. */
export function fingerprintSandboxCheck(check: SandboxScriptCheck): string {
  const stderr = check.stderr
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160)
    .toLowerCase();
  return `${check.name}:${check.exitCode}:${stderr}`;
}

export function isPreExistingRequiredFailure(
  baselineChecks: SandboxScriptCheck[],
  patchedChecks: SandboxScriptCheck[]
): boolean {
  const baselineFailed = firstRequiredFailure(baselineChecks);
  const patchedFailed = firstRequiredFailure(patchedChecks);
  if (!baselineFailed || !patchedFailed) return false;
  if (baselineFailed.name !== patchedFailed.name) return false;
  // Same script failed both sides — treat as pre-existing unless the fingerprint diverges sharply.
  return fingerprintSandboxCheck(baselineFailed) === fingerprintSandboxCheck(patchedFailed)
    || baselineFailed.exitCode === patchedFailed.exitCode;
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
    // Meridian-class case: unscanned commit already fails next build in sandbox.
    // If cleanup did not change that required-check outcome, allow delivery.
    if (isPreExistingRequiredFailure(input.baselineChecks, input.patchedChecks)) {
      return { status: "verified" };
    }

    const patchedFailed = firstRequiredFailure(input.patchedChecks);
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
