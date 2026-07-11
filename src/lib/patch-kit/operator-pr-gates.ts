export interface OperatorPrGateInput {
  locked: boolean;
  statusLoading: boolean;
  preflightLoading: boolean;
  repositoryAuthorized: boolean;
  permissionsVerified: boolean;
  canCreateBranch: boolean;
  canCreatePullRequest: boolean;
  useDemoAuth: boolean;
  manualTokenReady: boolean;
  patchValidated: boolean;
  validatedChanges: number;
  validatedEditCount: number;
  safeDeleteCount: number;
  requireVerificationForCleanupPr: boolean;
  verificationStatus?: "passed" | "failed" | "partial" | "not_run" | null;
}

export function computeOperatorPrGates(input: OperatorPrGateInput) {
  const githubPrPermissionsReady =
    input.repositoryAuthorized &&
    (input.canCreateBranch !== false || input.permissionsVerified) &&
    (input.canCreatePullRequest !== false || input.permissionsVerified);

  const canCreateReportPr =
    !input.locked &&
    (githubPrPermissionsReady || input.manualTokenReady || input.useDemoAuth) &&
    !input.preflightLoading &&
    !input.statusLoading;

  const hasValidatedWork =
    input.validatedChanges > 0 || input.validatedEditCount > 0 || input.safeDeleteCount > 0;

  const canCreateSafePr =
    canCreateReportPr &&
    hasValidatedWork &&
    input.patchValidated &&
    (!input.requireVerificationForCleanupPr || input.verificationStatus === "passed");

  return { githubPrPermissionsReady, canCreateReportPr, canCreateSafePr };
}
