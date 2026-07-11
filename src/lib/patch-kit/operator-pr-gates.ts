export interface OperatorPrGateInput {
  locked: boolean;
  statusLoading: boolean;
  preflightLoading: boolean;
  repositoryAuthorized: boolean;
  permissionsVerified: boolean;
  canCreateBranch: boolean;
  canCreatePullRequest: boolean;
  canWriteContents?: boolean;
  canWritePullRequests?: boolean;
  useDemoAuth: boolean;
  manualTokenReady: boolean;
  patchValidated: boolean;
  generatedChanges: number;
  validatedChanges: number;
  verifiedChanges: number;
  validatedEditCount: number;
  safeDeleteCount: number;
  requireVerificationForCleanupPr?: boolean;
  verificationStatus?: "passed" | "failed" | "partial" | "not_run" | "verified" | "blocked" | null;
}

export function computeOperatorPrGates(input: OperatorPrGateInput) {
  const githubPrPermissionsReady =
    input.repositoryAuthorized &&
    (input.canCreateBranch !== false || input.permissionsVerified) &&
    (input.canCreatePullRequest !== false || input.permissionsVerified) &&
    (input.canWriteContents !== false) &&
    (input.canWritePullRequests !== false);

  const canCreateReportPr =
    !input.locked &&
    (githubPrPermissionsReady || input.manualTokenReady || input.useDemoAuth) &&
    !input.preflightLoading &&
    !input.statusLoading;

  const verificationReady =
    input.verificationStatus === "passed" ||
    input.verificationStatus === "verified" ||
    (!input.requireVerificationForCleanupPr && input.verifiedChanges > 0);

  const hasVerifiedWork = input.verifiedChanges > 0;
  const hasGeneratedWork = input.generatedChanges > 0;

  const canCreateSafePr =
    canCreateReportPr &&
    hasGeneratedWork &&
    input.patchValidated &&
    input.validatedChanges > 0 &&
    hasVerifiedWork &&
    verificationReady &&
    githubPrPermissionsReady;

  return { githubPrPermissionsReady, canCreateReportPr, canCreateSafePr };
}
