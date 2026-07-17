import type { FindingAction } from "./types";
import { shouldForceReviewOperationalUnusedFile } from "./operational-file-protection";

const DO_NOT_TOUCH_PATTERNS: RegExp[] = [
  /(^|\/)\.env(\.|$)/,
  /(^|\/)\.env\.example$/,
  /package-lock\.json$/,
  /pnpm-lock\.yaml$/,
  /yarn\.lock$/,
  /bun\.lockb$/,
  /next\.config\.(js|mjs|ts|cjs)$/,
  /tsconfig(\..*)?\.json$/,
  /(^|\/)middleware\.(ts|js)$/,
  /(^|\/)app\/.*\/page\.(tsx?|jsx?)$/,
  /(^|\/)app\/.*\/layout\.(tsx?|jsx?)$/,
  /(^|\/)app\/.*\/route\.(tsx?|jsx?)$/,
  /(^|\/)pages\/.*\.(tsx?|jsx?)$/,
  /(^|\/)public\/.*\.(png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf)$/i,
  /(^|\/)src\/app\/global-error\.(tsx?|jsx?)$/,
  /(^|\/)app\/global-error\.(tsx?|jsx?)$/,
  /(^|\/)eslint\.config\.(mjs|cjs|js|ts)$/,
  /(^|\/)postcss\.config\.(mjs|cjs|js|ts)$/,
  /(^|\/)tailwind\.config\.(mjs|cjs|js|ts)$/,
  /(^|\/)instrumentation\.(ts|js)$/,
];

const SAFE_CANDIDATE_PATTERNS: RegExp[] = [
  /(^|\/)(archive|backup|old|unused|tmp|temp)(\/|$)/i,
  /-backup\./i,
  /-old\./i,
  /\.bak$/,
  /(^|\/)old\//i,
  /feature-backup/i,
  /card-unused/i,
  /unused-demo/i,
];

const ROUTE_LIKE_PATTERNS: RegExp[] = [
  /(^|\/)app\/.*\/(page|layout|route|loading|error|not-found)\.(tsx?|jsx?)$/,
  /(^|\/)pages\/.*\.(tsx?|jsx?)$/,
  /(^|\/)app\/api\/.*\/route\.(tsx?|jsx?)$/,
];

export function isDoNotTouchPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return DO_NOT_TOUCH_PATTERNS.some((p) => p.test(normalized));
}

export function isRouteLikePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return ROUTE_LIKE_PATTERNS.some((p) => p.test(normalized));
}

export function isSafeCandidatePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return SAFE_CANDIDATE_PATTERNS.some((p) => p.test(normalized));
}

export function classifyAction(
  filePaths: string[],
  opts?: { type?: string; forceReview?: boolean; source?: string }
): FindingAction {
  if (filePaths.some(isDoNotTouchPath)) return "do_not_touch";
  if (opts?.forceReview || filePaths.some(isRouteLikePath)) return "review_first";

  const allSafePaths = filePaths.every(isSafeCandidatePath) && filePaths.length > 0;
  if (
    shouldForceReviewOperationalUnusedFile(filePaths, {
      type: opts?.type,
      source: opts?.source,
      alreadySafePath: allSafePaths,
    })
  ) {
    return "review_first";
  }

  if (allSafePaths) {
    return "safe_candidate";
  }
  if (opts?.type === "duplicate_code") return "review_first";
  if (opts?.type === "unused_dependency") return "review_first";
  return "review_first";
}
