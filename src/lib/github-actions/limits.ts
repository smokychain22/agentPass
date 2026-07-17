/** Free GitHub Actions on-demand analysis limits (honest capacity). */

export const ACTIONS_ANALYSIS_LIMITS = {
  maxArchiveBytes: 100 * 1024 * 1024,
  maxFiles: 20_000,
  maxJobDurationMs: 5 * 60 * 60_000, // below GitHub's 6h hard cap
  maxOutputBytes: 32 * 1024 * 1024,
  languages: ["javascript", "typescript"] as const,
  concurrencyPerTenant: 1,
  readOnlyOnly: true,
} as const;

export type ActionsLimitCode =
  | "REPOSITORY_TOO_LARGE"
  | "FILE_LIMIT_EXCEEDED"
  | "ANALYSIS_TIME_LIMIT"
  | "CAPACITY_LIMIT"
  | "UNSUPPORTED_REPOSITORY";

export function checkArchiveSize(bytes: number): ActionsLimitCode | null {
  if (bytes > ACTIONS_ANALYSIS_LIMITS.maxArchiveBytes) return "REPOSITORY_TOO_LARGE";
  return null;
}

export function checkFileCount(count: number): ActionsLimitCode | null {
  if (count > ACTIONS_ANALYSIS_LIMITS.maxFiles) return "FILE_LIMIT_EXCEEDED";
  return null;
}
