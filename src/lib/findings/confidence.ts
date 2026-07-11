import path from "node:path";
import type { FindingSeverity } from "./types";
import {
  classifyAction,
  isDoNotTouchPath,
  isRouteLikePath,
  isSafeCandidatePath,
} from "./confidence-path-rules";

export {
  classifyAction,
  isDoNotTouchPath,
  isRouteLikePath,
  isSafeCandidatePath,
} from "./confidence-path-rules";

export function severityForAction(action: import("./types").FindingAction): FindingSeverity {
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
