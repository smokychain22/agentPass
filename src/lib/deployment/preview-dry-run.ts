/**
 * Server-side Preview / non-production dry-run enforcement.
 * Trust Vercel deployment labels (`VERCEL_ENV`). Never rely on the browser alone.
 *
 * When `VERCEL_ENV` is unset (local unit tests / offline), dry-run is off unless
 * `REPODIET_FORCE_PREVIEW_DRY_RUN=1`. When `VERCEL_ENV=preview|development`,
 * real payment and repository writes are refused unless explicitly re-enabled.
 */

export type DeploymentEnvironment = "production" | "preview" | "development" | "test" | "unknown";

export const PREVIEW_DRY_RUN_CODE = "PREVIEW_DRY_RUN_ONLY" as const;

export interface PreviewDryRunDenial {
  code: typeof PREVIEW_DRY_RUN_CODE;
  environment: DeploymentEnvironment;
  paymentAllowed: false;
  repositoryWriteAllowed: false;
  message: string;
}

export class PreviewDryRunError extends Error {
  readonly code = PREVIEW_DRY_RUN_CODE;
  readonly denial: PreviewDryRunDenial;

  constructor(message?: string) {
    const denial = buildPreviewDryRunDenial(message);
    super(denial.message);
    this.name = "PreviewDryRunError";
    this.denial = denial;
  }
}

export function getDeploymentEnvironment(
  env: NodeJS.ProcessEnv = process.env
): DeploymentEnvironment {
  const vercel = (env.VERCEL_ENV || env.NEXT_PUBLIC_VERCEL_ENV || "").toLowerCase();
  if (vercel === "production") return "production";
  if (vercel === "preview") return "preview";
  if (vercel === "development") return "development";
  if (env.NODE_ENV === "test") return "test";
  if (env.NODE_ENV === "development") return "development";
  if (env.NODE_ENV === "production" && !vercel) return "unknown";
  return vercel ? "unknown" : env.NODE_ENV === "production" ? "unknown" : "development";
}

/** True only for Vercel Production. */
export function isProductionDeployment(env: NodeJS.ProcessEnv = process.env): boolean {
  return getDeploymentEnvironment(env) === "production";
}

/**
 * True when this process is a Vercel-labeled non-production deployment
 * (or dry-run was forced for local verification).
 */
export function isVercelNonProductionDeployment(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.REPODIET_FORCE_PREVIEW_DRY_RUN === "1") return true;
  const vercel = (env.VERCEL_ENV || "").toLowerCase();
  return vercel === "preview" || vercel === "development";
}

/**
 * Non-production Vercel deployments run in dry-run for payment + repository mutation.
 * Explicit escape hatches exist for controlled live Preview tests only.
 *
 * Testnet Preview canaries must set:
 *   REPODIET_PAYMENT_MODE=testnet
 *   REPODIET_PREVIEW_ALLOW_LIVE_PAYMENT=1
 *   REPODIET_PREVIEW_ALLOW_REPO_WRITE=1 (only when GitHub App delivery is in scope)
 * Mainnet payment remains blocked on Preview even with the live-payment flag.
 */
export function isPreviewDryRun(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!isVercelNonProductionDeployment(env)) return false;
  if (env.REPODIET_PREVIEW_ALLOW_LIVE_PAYMENT === "1" && env.REPODIET_PREVIEW_ALLOW_REPO_WRITE === "1") {
    return false;
  }
  return true;
}

export function isPreviewPaymentBlocked(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!isVercelNonProductionDeployment(env)) return false;
  if (env.REPODIET_PREVIEW_ALLOW_LIVE_PAYMENT !== "1") return true;
  // Live Preview payment is permitted only for explicit testnet mode.
  const mode = (env.REPODIET_PAYMENT_MODE || "").trim().toLowerCase();
  if (mode === "testnet") return false;
  return true;
}

export function isPreviewRepositoryWriteBlocked(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!isVercelNonProductionDeployment(env)) return false;
  return env.REPODIET_PREVIEW_ALLOW_REPO_WRITE !== "1";
}

export function buildPreviewDryRunDenial(message?: string): PreviewDryRunDenial {
  const environment = getDeploymentEnvironment();
  return {
    code: PREVIEW_DRY_RUN_CODE,
    environment,
    paymentAllowed: false,
    repositoryWriteAllowed: false,
    message:
      message ||
      `PREVIEW_DRY_RUN_ONLY: ${environment} cannot authorize real payment or mutate repositories.`,
  };
}

export function assertPreviewAllowsPayment(): void {
  if (isPreviewPaymentBlocked()) {
    throw new PreviewDryRunError(
      "PREVIEW_DRY_RUN_ONLY: real payment authorization is disabled outside Production."
    );
  }
}

export function assertPreviewAllowsRepositoryWrite(): void {
  if (isPreviewRepositoryWriteBlocked()) {
    throw new PreviewDryRunError(
      "PREVIEW_DRY_RUN_ONLY: repository write token minting and GitHub mutation are disabled outside Production."
    );
  }
}

export function assertPreviewAllowsCleanupDispatch(): void {
  if (isPreviewRepositoryWriteBlocked()) {
    throw new PreviewDryRunError(
      "PREVIEW_DRY_RUN_ONLY: cleanup workflow dispatch is disabled outside Production."
    );
  }
}

export function previewDryRunJsonResponse(init?: { status?: number; message?: string }): Response {
  const denial = buildPreviewDryRunDenial(init?.message);
  return Response.json(denial, { status: init?.status ?? 403 });
}
