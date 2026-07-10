import type { Finding, FindingsPayload } from "./types";
import { projectRootPrefixes, selectPrimaryProjectRoot } from "@/lib/repository-model/primary-root";
import type { RepositoryModel } from "@/lib/repository-model/types";

function findingSymbol(finding: Finding): string {
  const symbol = finding.evidence.signals.find((s) => s.startsWith("symbol="));
  if (symbol) return symbol.slice("symbol=".length);
  if (finding.packageName) return finding.packageName;
  return finding.title;
}

function canonicalPath(filePath: string, mirrorPrefixes: string[]): string {
  const normalized = filePath.replace(/\\/g, "/");
  for (const prefix of mirrorPrefixes) {
    if (normalized.startsWith(`${prefix}/`)) {
      return normalized.slice(prefix.length + 1);
    }
  }
  const srcIdx = normalized.indexOf("/src/");
  if (srcIdx > 0) return normalized.slice(srcIdx + 1);
  return normalized;
}

export function canonicalFindingKey(
  finding: Finding,
  mirrorPrefixes: string[]
): string {
  const file = finding.files[0] ?? "";
  const canonicalFile = canonicalPath(file, mirrorPrefixes);
  return `${finding.type}|${findingSymbol(finding)}|${canonicalFile}`;
}

export function deduplicateCanonicalFindings(
  findings: Finding[],
  model?: RepositoryModel
): Finding[] {
  const mirrorPrefixes = model ? projectRootPrefixes(model) : [];
  const primaryRoot = model ? selectPrimaryProjectRoot(model) : "";

  const byKey = new Map<string, Finding>();
  for (const finding of findings) {
    const key = canonicalFindingKey(finding, mirrorPrefixes);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, finding);
      continue;
    }

    const file = finding.files[0] ?? "";
    const existingFile = existing.files[0] ?? "";
    const preferNew =
      (primaryRoot && file.startsWith(`${primaryRoot}/`)) ||
      (!primaryRoot && !mirrorPrefixes.some((p) => file.startsWith(`${p}/`)) &&
        mirrorPrefixes.some((p) => existingFile.startsWith(`${p}/`)));

    if (preferNew) byKey.set(key, finding);
  }

  return [...byKey.values()];
}

export function filterFindingsToPrimaryRoot(
  findings: Finding[],
  primaryRoot: string,
  mirrorPrefixes: string[]
): Finding[] {
  if (!primaryRoot && mirrorPrefixes.length <= 1) return findings;
  return findings.filter((f) => {
    const file = f.files[0];
    if (!file) return true;
    if (!primaryRoot) {
      return !mirrorPrefixes.some((p) => file.startsWith(`${p}/`));
    }
    return file.startsWith(`${primaryRoot}/`) || file === primaryRoot;
  });
}

export function rebuildFindingsPayload(
  payload: FindingsPayload,
  findings: Finding[]
): FindingsPayload {
  const duplicates = findings.filter((f) => f.type === "duplicate_code");
  const unusedFiles = findings.filter((f) => f.type === "unused_file");
  const unusedDependencies = findings.filter((f) => f.type === "unused_dependency");
  const unusedExports = findings.filter(
    (f) => f.type === "unused_export" || f.type === "unused_import"
  );
  const orphans = findings.filter((f) => f.type === "orphan_pattern");
  const slopSignals = findings.filter((f) => f.type === "ai_slop_signal");

  return {
    ...payload,
    duplicates,
    unused: {
      files: unusedFiles,
      dependencies: unusedDependencies,
      exports: unusedExports,
    },
    orphans,
    slopSignals,
    riskBuckets: {
      safeDelete: findings.filter((f) => f.action === "safe_candidate").map((f) => f.id),
      reviewFirst: findings.filter((f) => f.action === "review_first").map((f) => f.id),
      doNotTouch: findings.filter((f) => f.action === "do_not_touch").map((f) => f.id),
    },
  };
}
