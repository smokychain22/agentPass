import {
  isDoNotTouchPath,
  isRouteLikePath,
  isSafeCandidatePath,
} from "@/lib/findings/confidence-path-rules";

const EXTRA_BLOCKED: RegExp[] = [
  /(^|\/)package\.json$/,
  /(^|\/)package-lock\.json$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)bun\.lockb$/,
  /(^|\/)next\.config\.(js|mjs|ts|cjs)$/,
  /(^|\/)vite\.config\.(js|mjs|ts|cjs)$/,
  /(^|\/)tsconfig(\..*)?\.json$/,
  /(^|\/)eslint\.config\.(js|mjs|ts|cjs)$/,
  /(^|\/)tailwind\.config\.(js|mjs|ts|cjs)$/,
  /(^|\/)middleware\.(ts|js)$/,
  /(^|\/)public\//,
  /(^|\/)app\/.*\/page\.(tsx?|jsx?)$/,
  /(^|\/)app\/.*\/layout\.(tsx?|jsx?)$/,
  /(^|\/)app\/api\/.*\/route\.(tsx?|jsx?)$/,
  /(^|\/)pages\/.*\.(tsx?|jsx?)$/,
  /(^|\/)\.env(\.|$)/,
  /(^|\/)\.github\/workflows\//,
];

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function matchesAny(path: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(path));
}

const OPERATOR_SAFE_DIRS = /(^|\/)(archive|backup|old|tmp|temp)(\/|$)/i;
const OPERATOR_BACKUP_FILE = /\.(backup|old|bak)\./i;

/** Final gate before any file deletion on a cleanup branch. */
export function isOperatorSafeDeletePath(filePath: string): boolean {
  const path = normalizePath(filePath);
  if (!path) return false;
  const inSafeDir = OPERATOR_SAFE_DIRS.test(path);
  const backupFile = OPERATOR_BACKUP_FILE.test(path);
  if (!inSafeDir && !backupFile) return false;
  if (isDoNotTouchPath(path) || isRouteLikePath(path)) return false;
  if (matchesAny(path, EXTRA_BLOCKED)) return false;
  return isSafeCandidatePath(path);
}

export function filterOperatorSafeDeletes(paths: string[]): string[] {
  const seen = new Set<string>();
  const safe: string[] = [];
  for (const raw of paths) {
    const path = normalizePath(raw);
    if (!path || seen.has(path)) continue;
    if (!isOperatorSafeDeletePath(path)) continue;
    seen.add(path);
    safe.push(path);
  }
  return safe.sort();
}
