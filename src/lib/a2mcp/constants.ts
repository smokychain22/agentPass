export const A2MCP_VERSION = "2.0.0";
export const SERVICE_NAME = "RepoDiet";

export const MAX_REPO_ZIP_BYTES = 25 * 1024 * 1024;
export const MAX_FILES_ANALYZED = 5000;
export const MAX_SINGLE_FILE_BYTES = 500 * 1024;
export const TOOL_TIMEOUT_MS = 60_000;
/** Quick Triage / analyze_repository paid path — OKX marketplace budget (20s). */
export { QUICK_TRIAGE_TIMEOUT_MS } from "./quick-triage-budget";
export const OPERATOR_TOOL_TIMEOUT_MS = 300_000;

export const DEFAULT_PROTECTED_FILES = [
  "env files",
  "lockfiles",
  "config files",
  "routes",
  "API routes",
  "public assets",
] as const;

export const REGRESSION_PROTECTED_FILES = [
  ".env",
  "package.json",
  "next.config.ts",
  "app/**/route.ts",
] as const;

export const PATCH_TOOL_POLICY = {
  autoDeletes: false,
  safeCandidatesOnly: true,
  reviewFirstExcludedFromPatch: true,
  doNotTouchProtected: true,
} as const;

export const SCAN_POLICY = {
  autoDeletes: false,
  requiresReview: true,
  protectedFiles: [...DEFAULT_PROTECTED_FILES],
} as const;

export const ENV_DETECTED_WARNING =
  ".env file detected — values were not read or displayed.";

export const FALLBACK_DEPENDENCY_WARNING =
  "Review before removing. Fallback dependency analysis can miss dynamic imports, config usage, scripts, and framework plugins.";

export const DEAD_FILES_NOTE =
  "Review First items are not automatic delete candidates.";
