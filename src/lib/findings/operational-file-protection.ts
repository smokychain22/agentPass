/**
 * Operational / deployment scripts must not become automatically removable
 * from unused-file analyzer evidence alone.
 */
const OPERATIONAL_SCRIPT_PATTERNS: RegExp[] = [
  /(^|\/)scripts\//i,
  /(^|\/)bin\//i,
  /(^|\/)tooling\//i,
  /(^|\/)ops\//i,
  /(^|\/)deploy\//i,
  /(^|\/)\.github\/workflows\//i,
  /(^|\/)\.github\/actions\//i,
  /(^|\/)docker-compose\./i,
  /(^|\/)Dockerfile/i,
  /vercel\.(json|ts|mjs|js)$/i,
  /sync-vercel-env/i,
  /vercel-preview-env/i,
  /test-birdeye/i,
];

/** Paths that look like operational / CI / deployment utilities. */
export function isOperationalScriptPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return OPERATIONAL_SCRIPT_PATTERNS.some((p) => p.test(normalized));
}

/**
 * Unused-file findings for operational scripts require Review First unless
 * stronger non-knip evidence already marks them safe (e.g. archive/tmp path).
 */
export function shouldForceReviewOperationalUnusedFile(
  filePaths: string[],
  opts?: { type?: string; source?: string; alreadySafePath?: boolean }
): boolean {
  if (opts?.type && opts.type !== "unused_file") return false;
  if (!filePaths.some(isOperationalScriptPath)) return false;
  // Archive/tmp naming can still be safe even under scripts/.
  if (opts?.alreadySafePath) return false;
  return true;
}
