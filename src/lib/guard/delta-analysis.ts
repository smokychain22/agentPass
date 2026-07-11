import type { Finding, FindingsPayload } from "@/lib/findings/types";
import { getStoredFindings } from "@/lib/findings/findings-store";
import {
  collectAllFindings,
  findingEvidenceHash,
  findingFingerprint,
  indexFindingsByFingerprint,
} from "./fingerprint";
import { classifyProtectedPathActivity, selectPolicySafeCandidates } from "./policy";
import { isFindingRejected } from "./repository-memory";
import type { RepositoryMemory } from "./types";
import type { GuardDelta } from "./types";

export async function analyzeGuardDelta(input: {
  memory: RepositoryMemory;
  previousScanId?: string;
  currentScanId: string;
  previousCommitSha?: string;
  currentCommitSha: string;
  currentFindings?: FindingsPayload;
}): Promise<GuardDelta> {
  const current =
    input.currentFindings ?? (await getStoredFindings(input.currentScanId));
  if (!current) {
    throw new Error(`Current scan not found: ${input.currentScanId}`);
  }

  const previous = input.previousScanId
    ? await getStoredFindings(input.previousScanId)
    : undefined;

  const currentAll = collectAllFindings(current);
  const previousAll = previous ? collectAllFindings(previous) : [];

  const prevMap = indexFindingsByFingerprint(previousAll);
  const currMap = indexFindingsByFingerprint(currentAll);

  const newFindings: Finding[] = [];
  const resolvedFindings: Finding[] = [];
  const recurringFindings: Finding[] = [];
  const ignoredFindings: Finding[] = [];

  for (const [fp, finding] of currMap) {
    const evidenceHash = findingEvidenceHash(finding);
    if (isFindingRejected(input.memory, fp, evidenceHash)) {
      ignoredFindings.push(finding);
      continue;
    }
    if (!prevMap.has(fp)) {
      newFindings.push(finding);
    } else {
      recurringFindings.push(finding);
    }
  }

  for (const [fp, finding] of prevMap) {
    if (!currMap.has(fp)) {
      resolvedFindings.push(finding);
    }
  }

  const newSafeCandidates = selectPolicySafeCandidates(newFindings, input.memory);
  const protectedPathActivity = classifyProtectedPathActivity(
    [...newFindings, ...recurringFindings],
    input.memory
  );

  const previousTotal = previous?.summary.totalFindings ?? 0;
  const currentTotal = current.summary.totalFindings;
  const delta = currentTotal - previousTotal;

  return {
    previousScanId: input.previousScanId,
    currentScanId: input.currentScanId,
    previousCommitSha: input.previousCommitSha,
    currentCommitSha: input.currentCommitSha,
    newFindings,
    resolvedFindings,
    recurringFindings,
    ignoredFindings,
    newSafeCandidates,
    protectedPathActivity,
    debtTrend: {
      previousTotal,
      currentTotal,
      delta,
      direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
    },
  };
}

export function deltaPresentation(delta: GuardDelta): Record<string, unknown> {
  return {
    newCount: delta.newFindings.length,
    resolvedCount: delta.resolvedFindings.length,
    recurringCount: delta.recurringFindings.length,
    ignoredCount: delta.ignoredFindings.length,
    newSafeCandidates: delta.newSafeCandidates.map((f) => ({
      id: f.id,
      type: f.type,
      title: f.title,
      fingerprint: findingFingerprint(f),
    })),
    protectedPathActivity: delta.protectedPathActivity.map((f) => ({
      id: f.id,
      title: f.title,
      files: f.files,
    })),
    debtTrend: delta.debtTrend,
    presentedFindings: delta.newFindings.map((f) => ({
      id: f.id,
      type: f.type,
      title: f.title,
      action: f.action,
      fingerprint: findingFingerprint(f),
    })),
  };
}
