import { durableNow, getDurableRecord, setDurableRecord } from "@/lib/store/durable-store";
import type { FindingType } from "@/lib/findings/types";
import {
  DEFAULT_REPOSITORY_MEMORY,
  type CleanupPrRecord,
  type RejectedFindingRecord,
  type RepositoryMemory,
} from "./types";

function policyKey(repository: string): string {
  return repository;
}

export async function loadRepositoryMemory(
  repository: string,
  branch = "main"
): Promise<RepositoryMemory> {
  const existing = await getDurableRecord<Partial<RepositoryMemory>>(
    "repository_policies",
    policyKey(repository)
  );
  if (existing?.repository) {
    return {
      ...DEFAULT_REPOSITORY_MEMORY,
      ...existing,
      id: policyKey(repository),
      repository,
      branch: existing.branch ?? branch,
      rejectedFindings: existing.rejectedFindings ?? [],
      acceptedFindings: existing.acceptedFindings ?? [],
      previousCleanupPrs: existing.previousCleanupPrs ?? [],
      approvalPreferences: {
        ...DEFAULT_REPOSITORY_MEMORY.approvalPreferences,
        ...existing.approvalPreferences,
      },
      notificationSettings: {
        ...DEFAULT_REPOSITORY_MEMORY.notificationSettings,
        ...existing.notificationSettings,
      },
      updatedAt: existing.updatedAt ?? durableNow(),
    };
  }

  const memory: RepositoryMemory = {
    id: policyKey(repository),
    repository,
    branch,
    ...DEFAULT_REPOSITORY_MEMORY,
    updatedAt: durableNow(),
  };
  await setDurableRecord("repository_policies", policyKey(repository), memory);
  return memory;
}

export async function saveRepositoryMemory(memory: RepositoryMemory): Promise<RepositoryMemory> {
  const record = { ...memory, updatedAt: durableNow() };
  await setDurableRecord("repository_policies", policyKey(memory.repository), record);
  return record;
}

export async function updateRepositoryPolicy(input: {
  repository: string;
  branch?: string;
  protectedPaths?: string[];
  protectedGlobs?: string[];
  allowAutomaticFixes?: FindingType[];
  requireChecks?: string[];
  neverAutoModify?: string[];
  verificationCommands?: string[];
  frameworkEntryPoints?: string[];
  githubInstallationId?: string;
  callbackUrl?: string;
}): Promise<RepositoryMemory> {
  const memory = await loadRepositoryMemory(input.repository, input.branch ?? "main");
  if (input.branch) memory.branch = input.branch;
  if (input.protectedPaths) memory.protectedPaths = input.protectedPaths;
  if (input.protectedGlobs?.length) {
    memory.protectedPaths = [...new Set([...memory.protectedPaths, ...input.protectedGlobs])];
  }
  if (input.allowAutomaticFixes) memory.allowAutomaticFixes = input.allowAutomaticFixes;
  if (input.requireChecks) memory.requireChecks = input.requireChecks;
  if (input.neverAutoModify) memory.neverAutoModify = input.neverAutoModify;
  if (input.verificationCommands) memory.verificationCommands = input.verificationCommands;
  if (input.frameworkEntryPoints) memory.frameworkEntryPoints = input.frameworkEntryPoints;
  if (input.githubInstallationId) memory.githubInstallationId = input.githubInstallationId;
  if (input.callbackUrl) memory.notificationSettings.callbackUrl = input.callbackUrl;
  return saveRepositoryMemory(memory);
}

export async function recordRejectedFinding(
  repository: string,
  record: RejectedFindingRecord
): Promise<RepositoryMemory> {
  const memory = await loadRepositoryMemory(repository);
  const without = memory.rejectedFindings.filter((r) => r.fingerprint !== record.fingerprint);
  memory.rejectedFindings = [...without, record];
  return saveRepositoryMemory(memory);
}

export async function recordAcceptedFinding(
  repository: string,
  fingerprint: string
): Promise<RepositoryMemory> {
  const memory = await loadRepositoryMemory(repository);
  if (!memory.acceptedFindings.includes(fingerprint)) {
    memory.acceptedFindings.push(fingerprint);
  }
  return saveRepositoryMemory(memory);
}

export async function recordCleanupPr(
  repository: string,
  pr: CleanupPrRecord
): Promise<RepositoryMemory> {
  const memory = await loadRepositoryMemory(repository);
  memory.previousCleanupPrs = [pr, ...memory.previousCleanupPrs].slice(0, 20);
  return saveRepositoryMemory(memory);
}

export function isFindingRejected(
  memory: RepositoryMemory,
  fingerprint: string,
  evidenceHash?: string
): boolean {
  const rejected = memory.rejectedFindings.find((r) => r.fingerprint === fingerprint);
  if (!rejected) return false;
  if (!memory.notificationSettings.suppressIgnoredUnlessNewEvidence) return true;
  if (!evidenceHash || !rejected.evidenceHash) return true;
  return rejected.evidenceHash === evidenceHash;
}
