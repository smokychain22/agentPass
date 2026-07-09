import path from "node:path";
import type { FindingAction, FindingSeverity } from "./types";

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
  opts?: { type?: string; forceReview?: boolean }
): FindingAction {
  if (filePaths.some(isDoNotTouchPath)) return "do_not_touch";
  if (opts?.forceReview || filePaths.some(isRouteLikePath)) return "review_first";
  if (filePaths.every(isSafeCandidatePath) && filePaths.length > 0) {
    return "safe_candidate";
  }
  if (opts?.type === "duplicate_code") return "review_first";
  if (opts?.type === "unused_dependency") return "review_first";
  return "review_first";
}

export function severityForAction(action: FindingAction): FindingSeverity {
  if (action === "do_not_touch") return "high";
  if (action === "safe_candidate") return "low";
  return "medium";
}

export function clampConfidence(value: number): number {
  return Math.round(Math.min(0.99, Math.max(0.35, value)) * 100) / 100;
}

export function normalizeRepoPath(rootDir: string, filePath: string): string {
  const rel = path.isAbsolute(filePath)
    ? path.relative(rootDir, filePath)
    : filePath;
  return rel.replace(/\\/g, "/");
}
