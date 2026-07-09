import type { Finding, FindingsPayload } from "@/lib/findings/types";
import {
  isDoNotTouchPath,
  isRouteLikePath,
  isSafeCandidatePath,
} from "@/lib/findings/confidence-path-rules";
import type { ClassifiedBuckets, ClassifiedItem } from "./types";

const NEVER_PATCH_PATTERNS: RegExp[] = [
  /(^|\/)package\.json$/,
  /(^|\/)vite\.config\.(js|mjs|ts|cjs)$/,
  /(^|\/)tailwind\.config\.(js|mjs|ts|cjs)$/,
  /(^|\/)eslint\.config\.(js|mjs|ts|cjs)$/,
  /(^|\/)public\//,
  /(^|\/)app\/api\//,
  /(^|\/)pages\/api\//,
  /(^|\/)api\/.*\/route\.(tsx?|jsx?)$/,
];

const REVIEW_FIRST_DIR_PATTERNS: RegExp[] = [
  /(^|\/)components\//,
  /(^|\/)lib\//,
  /(^|\/)hooks\//,
  /(^|\/)utils\//,
  /(^|\/)src\//,
  /(^|\/)app\/api\//,
];

const SAFE_FILE_PATTERNS: RegExp[] = [
  /\.backup\./i,
  /\.old\./i,
  /\.copy\./i,
  /\.unused\./i,
  /(^|\/)demo[^/]*\.(tsx?|jsx?|md)$/i,
];

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function matchesAny(path: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(path));
}

function classifyPath(
  filePath: string,
  finding?: Finding
): "safe_candidate" | "review_first" | "do_not_touch" {
  const path = normalizePath(filePath);
  if (!path || path === "package.json") return "do_not_touch";

  if (isDoNotTouchPath(path) || matchesAny(path, NEVER_PATCH_PATTERNS)) {
    return "do_not_touch";
  }

  if (isRouteLikePath(path)) return "do_not_touch";

  if (finding?.type === "duplicate_code") return "review_first";
  if (finding?.action === "do_not_touch") return "do_not_touch";
  if (finding?.action === "review_first") return "review_first";

  if (
    isSafeCandidatePath(path) ||
    matchesAny(path, SAFE_FILE_PATTERNS) ||
    finding?.action === "safe_candidate"
  ) {
    if (matchesAny(path, REVIEW_FIRST_DIR_PATTERNS) && !isSafeCandidatePath(path)) {
      return "review_first";
    }
    return "safe_candidate";
  }

  if (matchesAny(path, REVIEW_FIRST_DIR_PATTERNS)) return "review_first";

  if (finding?.type === "orphan_pattern") return "review_first";
  if (finding?.type === "unused_file") return "review_first";
  if (finding?.type === "ai_slop_signal") return "review_first";

  return "review_first";
}

function itemKey(path: string): string {
  return normalizePath(path);
}

function upsertItem(
  bucket: Map<string, ClassifiedItem>,
  path: string,
  reason: string,
  finding?: Finding
): void {
  const key = itemKey(path);
  if (!key) return;

  const existing = bucket.get(key);
  if (existing) {
    if (finding?.id && !existing.findingId) existing.findingId = finding.id;
    return;
  }

  bucket.set(key, {
    path: key,
    reason,
    findingId: finding?.id,
    findingType: finding?.type,
  });
}

function collectAllFindings(findings: FindingsPayload): Finding[] {
  return [
    ...findings.duplicates,
    ...findings.unused.files,
    ...findings.unused.dependencies,
    ...findings.unused.exports,
    ...findings.orphans,
    ...findings.slopSignals,
  ];
}

export function classifyFindingsForPatch(findings: FindingsPayload): ClassifiedBuckets {
  const safeDelete = new Map<string, ClassifiedItem>();
  const reviewFirst = new Map<string, ClassifiedItem>();
  const doNotTouch = new Map<string, ClassifiedItem>();

  const allFindings = collectAllFindings(findings);

  for (const finding of allFindings) {
    if (finding.type === "unused_dependency") continue;

    for (const filePath of finding.files) {
      const action = classifyPath(filePath, finding);
      const reason =
        finding.reason ||
        (action === "safe_candidate"
          ? "Matches safe-delete heuristics."
          : action === "do_not_touch"
            ? "Protected framework or runtime file."
            : "Requires manual review before deletion.");

      const bucket =
        action === "safe_candidate"
          ? safeDelete
          : action === "do_not_touch"
            ? doNotTouch
            : reviewFirst;

      upsertItem(bucket, filePath, reason, finding);
    }
  }

  for (const [path, item] of [...safeDelete.entries()]) {
    const reclasified = classifyPath(path);
    if (reclasified !== "safe_candidate") {
      safeDelete.delete(path);
      const target = reclasified === "do_not_touch" ? doNotTouch : reviewFirst;
      upsertItem(target, path, item.reason, undefined);
    }
  }

  return {
    safeDelete: [...safeDelete.values()].sort((a, b) => a.path.localeCompare(b.path)),
    reviewFirst: [...reviewFirst.values()].sort((a, b) => a.path.localeCompare(b.path)),
    doNotTouch: [...doNotTouch.values()].sort((a, b) => a.path.localeCompare(b.path)),
  };
}
