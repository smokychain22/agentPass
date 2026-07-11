import { parseGitHubUrl } from "@/lib/github/parse-github-url";
import {
  ASP_CLEANUP_MODES,
  ASP_MAXIMUM_CHANGES_LIMIT,
  ASP_VERIFICATION_CHECKS,
  type AspCleanupMode,
  type AspVerificationCheck,
  type CreateAspJobInput,
} from "./types";

export interface ValidatedAspJobInput {
  okxOrderId: string;
  repositoryUrl: string;
  repositoryOwner: string;
  repositoryName: string;
  baseBranch: string;
  cleanupMode: AspCleanupMode;
  maximumChanges: number;
  requiredChecks: AspVerificationCheck[];
  userId?: string;
}

export function validateCreateAspJobInput(
  input: CreateAspJobInput
): { ok: true; value: ValidatedAspJobInput } | { ok: false; error: string } {
  const okxOrderId = input.okxOrderId?.trim();
  if (!okxOrderId) {
    return { ok: false, error: "okxOrderId is required." };
  }

  const repositoryUrl = input.repositoryUrl?.trim();
  if (!repositoryUrl) {
    return { ok: false, error: "repositoryUrl is required." };
  }

  const parsed = parseGitHubUrl(repositoryUrl);
  if (!parsed) {
    return { ok: false, error: "repositoryUrl must be a valid GitHub repository URL." };
  }

  const baseBranch = (input.baseBranch?.trim() || parsed.branch || "main").slice(0, 120);
  if (!/^[A-Za-z0-9._/-]+$/.test(baseBranch)) {
    return { ok: false, error: "baseBranch contains unsupported characters." };
  }

  const cleanupMode = (input.cleanupMode?.trim() || "safe") as AspCleanupMode;
  if (!ASP_CLEANUP_MODES.includes(cleanupMode)) {
    return { ok: false, error: `cleanupMode must be one of: ${ASP_CLEANUP_MODES.join(", ")}.` };
  }

  const maximumChanges = Number(input.maximumChanges ?? 20);
  if (!Number.isFinite(maximumChanges) || maximumChanges < 1) {
    return { ok: false, error: "maximumChanges must be a positive integer." };
  }
  if (maximumChanges > ASP_MAXIMUM_CHANGES_LIMIT) {
    return {
      ok: false,
      error: `maximumChanges cannot exceed ${ASP_MAXIMUM_CHANGES_LIMIT}.`,
    };
  }

  const requiredChecks = normalizeRequiredChecks(input.requiredChecks);
  if (!requiredChecks.ok) {
    return { ok: false, error: requiredChecks.error };
  }

  return {
    ok: true,
    value: {
      okxOrderId,
      repositoryUrl: `https://github.com/${parsed.owner}/${parsed.repo}`,
      repositoryOwner: parsed.owner,
      repositoryName: parsed.repo,
      baseBranch,
      cleanupMode,
      maximumChanges,
      requiredChecks: requiredChecks.value,
      userId: input.userId?.trim() || undefined,
    },
  };
}

function normalizeRequiredChecks(
  checks?: string[]
): { ok: true; value: AspVerificationCheck[] } | { ok: false; error: string } {
  const raw = checks?.length ? checks : [...ASP_VERIFICATION_CHECKS];
  const normalized: AspVerificationCheck[] = [];
  for (const check of raw) {
    const value = check.trim().toLowerCase() as AspVerificationCheck;
    if (!ASP_VERIFICATION_CHECKS.includes(value)) {
      return {
        ok: false,
        error: `Unsupported requiredChecks value: ${check}. Allowed: ${ASP_VERIFICATION_CHECKS.join(", ")}.`,
      };
    }
    if (!normalized.includes(value)) {
      normalized.push(value);
    }
  }
  return { ok: true, value: normalized };
}
