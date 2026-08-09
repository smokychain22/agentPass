import type { PatchKitPayload } from "@/lib/patch-kit/types";

/**
 * Compact, safe-to-log projection of a verification result's real
 * phase-by-phase timing. See create-cleanup-pr.ts's NO_SAFE_CANDIDATES throw
 * site (verifiedChanges === 0) for why this exists: a terse `.error` string
 * alone couldn't distinguish a genuinely slow check from a retry storm or
 * something else — the real per-step `durationMs` data that would answer
 * that was computed in `repositoryVerification` and then discarded before
 * reaching any caller.
 *
 * Deliberately kept in its own file, importing only types (no runtime
 * dependencies) from create-cleanup-pr.ts's sibling modules, so it stays
 * directly unit-testable without pulling in the real clone/install/verify
 * pipeline that importing create-cleanup-pr.ts itself requires.
 */
export function summarizeVerificationForDiagnostics(
  verification: PatchKitPayload["repositoryVerification"]
):
  | {
      checks: Array<{ name: string; status: string; exitCode: number | null; durationMs: number }>;
      installAttempts: Array<{ attempt: number; command: string; exitCode: number | null; durationMs: number }>;
    }
  | undefined {
  if (!verification) return undefined;
  return {
    checks: (verification.checks ?? []).map((c) => ({
      name: c.name,
      status: c.status,
      exitCode: c.exitCode,
      durationMs: c.durationMs,
    })),
    installAttempts: (verification.installAttempts ?? []).map((a) => ({
      attempt: a.attempt,
      command: a.command,
      exitCode: a.exitCode,
      durationMs: a.durationMs,
    })),
  };
}
