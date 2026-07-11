/**
 * Shared execution engine — the only entry point for core product behavior.
 * Website routes, A2MCP tools, A2A handlers, and OKX interfaces must call these.
 */
import type { FindingsPayload } from "@/lib/findings/types";
import { runFindingsEngine } from "@/lib/findings/findings-engine";
import type { PatchKitPayload } from "@/lib/patch-kit/types";
import { createCleanupPullRequest as createCleanupPr } from "@/lib/operator/create-cleanup-pr";
import { isEligibleFinding } from "@/lib/findings/actionability-signals";
import {
  listAutoFixEligible,
  FREE_CLEANUP_LIMIT,
  QUICK_CLEANUP_LIMIT,
} from "@/lib/cleanup/eligibility";
import { runFreeCleanupCore, type FreeCleanupResult } from "./run-cleanup-core";
import { createTaskQuote as buildTaskQuote, type TaskOperation, type TaskQuote } from "./task-quote";
import {
  signExecutionReceipt,
  type ExecutionReceipt,
} from "@/lib/operator/sign-receipt";
import {
  saveCleanupRun,
  saveExecutionReceiptRecord,
  saveRepositorySnapshot,
  saveTaskQuote,
  upsertRepository,
} from "@/lib/store/product-store";
import { storeFindings } from "@/lib/findings/findings-store";

export type { TaskOperation, TaskQuote, FreeCleanupResult, ExecutionReceipt };

export async function scanRepository(repoUrl: string, branch?: string) {
  const payload = await runFindingsEngine(repoUrl, branch);
  const repo = await upsertRepository({
    owner: payload.repo.owner,
    name: payload.repo.name,
    branch: payload.repo.branch,
    url: payload.repo.url ?? `https://github.com/${payload.repo.owner}/${payload.repo.name}`,
  });
  if (payload.repo.commitSha) {
    await saveRepositorySnapshot({
      repositoryId: repo.id,
      branch: payload.repo.branch,
      commitSha: payload.repo.commitSha,
    });
  }
  await storeFindings(payload);
  return payload;
}

export async function analyzeRepository(findings: FindingsPayload) {
  return findings;
}

export function selectSafeFixes(findings: FindingsPayload, limit = QUICK_CLEANUP_LIMIT) {
  const all = [
    ...findings.duplicates,
    ...findings.unused.files,
    ...findings.unused.dependencies,
    ...findings.unused.exports,
    ...findings.orphans,
    ...findings.slopSignals,
  ];
  return listAutoFixEligible(all, limit);
}

export async function generateChanges(
  findings: FindingsPayload,
  options?: { findingIds?: string[]; maxFixes?: number; quickPatchMode?: boolean }
): Promise<FreeCleanupResult> {
  return runFreeCleanupCore(findings, options);
}

export async function verifyChanges(patchId: string) {
  const { runVerification } = await import("@/lib/verify/run-verification");
  return runVerification(patchId);
}

export async function createCleanupPullRequest(input: {
  repoUrl: string;
  branch?: string;
  findings?: FindingsPayload;
  patchKit?: PatchKitPayload;
  demo?: boolean;
  githubToken?: string;
}) {
  return createCleanupPr(input);
}

export function createTaskQuote(input: {
  repository: string;
  branch: string;
  commitSha: string;
  findingIds: string[];
  operation: TaskOperation;
  sourceFileCount?: number;
}): TaskQuote {
  return buildTaskQuote(input);
}

export function createExecutionReceipt(receipt: ExecutionReceipt) {
  return signExecutionReceipt(receipt);
}

export async function executeFreeProof(
  findings: FindingsPayload,
  options?: { findingIds?: string[] }
) {
  const result = await generateChanges(findings, {
    findingIds: options?.findingIds,
    maxFixes: FREE_CLEANUP_LIMIT,
  });

  const repository = `${findings.repo.owner}/${findings.repo.name}`;
  const commitSha = findings.repo.commitSha ?? "unknown";

  await saveCleanupRun(result, {
    repository,
    branch: findings.repo.branch,
    commitSha,
    scanId: findings.scanId,
  });

  const signed = createExecutionReceipt(result.receipt);
  await saveExecutionReceiptRecord(signed);

  return { ...result, signedReceipt: signed };
}

export async function executeTaskQuote(input: {
  repository: string;
  branch: string;
  commitSha: string;
  findingIds: string[];
  operation: import("./task-quote").TaskOperation;
  sourceFileCount?: number;
  idempotencyKey?: string;
}) {
  const { createQuoteForOperation } = await import("@/lib/payment");
  const quote = await createQuoteForOperation(input);
  return quote;
}

export async function executeQuickCleanup(
  findings: FindingsPayload,
  options?: { findingIds?: string[] }
) {
  const all = [
    ...findings.duplicates,
    ...findings.unused.files,
    ...findings.unused.dependencies,
    ...findings.unused.exports,
    ...findings.orphans,
    ...findings.slopSignals,
  ];
  const eligibleCount = all.filter(isEligibleFinding).length;

  const result = await generateChanges(findings, {
    findingIds: options?.findingIds,
    maxFixes: Math.max(eligibleCount, 1),
    quickPatchMode: true,
  });

  const repository = `${findings.repo.owner}/${findings.repo.name}`;
  const commitSha = findings.repo.commitSha ?? "unknown";

  await saveCleanupRun(result, {
    repository,
    branch: findings.repo.branch,
    commitSha,
    scanId: findings.scanId,
  });

  const signed = createExecutionReceipt(result.receipt);
  await saveExecutionReceiptRecord(signed);

  return { ...result, signedReceipt: signed };
}

export async function runQuickCleanup(
  repoUrl: string,
  branch: string | undefined,
  findings: FindingsPayload,
  selectedFindingIds?: string[]
) {
  const all = [
    ...findings.duplicates,
    ...findings.unused.files,
    ...findings.unused.dependencies,
    ...findings.unused.exports,
    ...findings.orphans,
    ...findings.slopSignals,
  ];
  const eligibleCount = all.filter(isEligibleFinding).length;

  return runFreeCleanupCore(findings, {
    findingIds: selectedFindingIds,
    maxFixes: Math.max(eligibleCount, 1),
    quickPatchMode: true,
  });
}

/** @deprecated Use createCleanupPullRequest */
export const createCleanupPullRequestFromEngine = createCleanupPullRequest;

/** @deprecated Use createTaskQuote */
export const quoteCleanupTask = createTaskQuote;

export async function activateRepoGuard(input: {
  repoUrl: string;
  branch?: string;
  quoteId?: string;
  paymentReference?: string;
  installationId?: string;
  callbackUrl?: string;
  protectedPaths?: string[];
}) {
  const { activateRepoGuard: activate } = await import("@/lib/guard/guard-engine");
  return activate(input);
}

export async function runGuardScan(repository: string) {
  const { runManualGuardScan } = await import("@/lib/guard/guard-engine");
  return runManualGuardScan(repository);
}

export async function getRepoGuardStatus(repository: string) {
  const { getGuardStatus } = await import("@/lib/guard/guard-engine");
  return getGuardStatus(repository);
}
