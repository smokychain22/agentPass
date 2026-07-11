import type { Finding } from "@/lib/findings/types";
import { isDoNotTouchPath, isRouteLikePath } from "@/lib/findings/confidence-path-rules";
import { isPhase1AutoFix } from "@/lib/execution/fix-plugins/phase1-plugins";
import type { RepositoryMemory } from "./types";
import { findingFingerprint } from "./fingerprint";

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "§§")
    .replace(/\*/g, "[^/]*")
    .replace(/§§/g, ".*");
  return new RegExp(`^${escaped}$`);
}

export function pathMatchesPolicyGlob(filePath: string, globs: string[]): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return globs.some((g) => globToRegExp(g).test(normalized));
}

export function isProtectedByMemoryPolicy(finding: Finding, memory: RepositoryMemory): boolean {
  if (finding.files.some((f) => pathMatchesPolicyGlob(f, memory.protectedPaths))) {
    return true;
  }
  if (finding.type === "unused_file" && memory.neverAutoModify.includes("database_migration")) {
    if (finding.files.some((f) => /migrations?\//i.test(f))) return true;
  }
  if (memory.neverAutoModify.includes("api_route")) {
    if (finding.files.some((f) => isRouteLikePath(f))) return true;
  }
  if (memory.neverAutoModify.includes("middleware")) {
    if (finding.files.some((f) => /middleware\.(ts|js)$/.test(f))) return true;
  }
  return finding.files.some((f) => isDoNotTouchPath(f));
}

export function isAutoFixAllowedByPolicy(finding: Finding, memory: RepositoryMemory): boolean {
  if (!memory.allowAutomaticFixes.includes(finding.type)) return false;
  if (isProtectedByMemoryPolicy(finding, memory)) return false;
  if (!isPhase1AutoFix(finding)) return false;
  return true;
}

export function classifyProtectedPathActivity(
  findings: Finding[],
  memory: RepositoryMemory
): Finding[] {
  return findings.filter((f) => isProtectedByMemoryPolicy(f, memory));
}

export function selectPolicySafeCandidates(
  findings: Finding[],
  memory: RepositoryMemory
): Finding[] {
  return findings.filter((f) => isAutoFixAllowedByPolicy(f, memory));
}

export function applyPolicyToFindingIds(
  findingIds: string[],
  findings: Finding[],
  memory: RepositoryMemory
): { allowed: string[]; blocked: string[] } {
  const byId = new Map(findings.map((f) => [f.id, f]));
  const allowed: string[] = [];
  const blocked: string[] = [];
  for (const id of findingIds) {
    const f = byId.get(id);
    if (!f) {
      blocked.push(id);
      continue;
    }
    if (isAutoFixAllowedByPolicy(f, memory)) allowed.push(id);
    else blocked.push(id);
  }
  return { allowed, blocked };
}

export function policySummary(memory: RepositoryMemory): Record<string, unknown> {
  return {
    protectedPaths: memory.protectedPaths,
    allowAutomaticFixes: memory.allowAutomaticFixes,
    requireChecks: memory.requireChecks,
    neverAutoModify: memory.neverAutoModify,
    rejectedCount: memory.rejectedFindings.length,
    acceptedCount: memory.acceptedFindings.length,
  };
}

export function fingerprintList(findings: Finding[]): string[] {
  return findings.map((f) => findingFingerprint(f));
}
