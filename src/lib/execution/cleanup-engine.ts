import type { FindingsPayload } from "@/lib/findings/types";
import { runFindingsEngine } from "@/lib/findings/findings-engine";
import { prepareRepoWorkspace } from "@/lib/scanner/prepare-workspace";
import { runPatchKitEngine } from "@/lib/patch-kit/patch-kit-engine";
import type { PatchKitPayload } from "@/lib/patch-kit/types";
import { createCleanupPullRequest } from "@/lib/operator/create-cleanup-pr";
import {
  listAutoFixEligible,
  FREE_CLEANUP_LIMIT,
  QUICK_CLEANUP_LIMIT,
} from "@/lib/cleanup/eligibility";
import { runFreeCleanupCore } from "./run-cleanup-core";
import { createTaskQuote, type TaskOperation } from "./task-quote";
import { signExecutionReceipt } from "@/lib/operator/sign-receipt";

export async function scanRepository(repoUrl: string, branch?: string) {
  return runFindingsEngine(repoUrl, branch);
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
  return listAutoFixEligible(all).slice(0, limit);
}

export async function generateChanges(
  findings: FindingsPayload,
  options?: { findingIds?: string[]; maxFixes?: number }
) {
  return runFreeCleanupCore(findings, options);
}

export async function verifyChanges(patchId: string) {
  const { runVerification } = await import("@/lib/verify/run-verification");
  return runVerification(patchId);
}

export async function createCleanupPullRequestFromEngine(input: {
  repoUrl: string;
  branch?: string;
  findings?: FindingsPayload;
  patchKit?: PatchKitPayload;
  demo?: boolean;
  githubToken?: string;
}) {
  return createCleanupPullRequest(input);
}

export async function runPatchKitGeneration(
  repoUrl: string,
  branch: string | undefined,
  findings: FindingsPayload,
  selectedFindingIds?: string[]
) {
  return runPatchKitEngine({
    repoUrl,
    branch: branch ?? findings.repo.branch,
    findings,
    selectedFindingIds,
  });
}

export function quoteCleanupTask(input: {
  repository: string;
  branch: string;
  commitSha: string;
  findingIds: string[];
  operation: TaskOperation;
  sourceFileCount?: number;
}) {
  return createTaskQuote(input);
}

export async function executeFreeProof(findings: FindingsPayload, findingIds?: string[]) {
  const result = await runFreeCleanupCore(findings, {
    findingIds,
    maxFixes: FREE_CLEANUP_LIMIT,
  });
  const signed = signExecutionReceipt(result.receipt);
  return { ...result, signedReceipt: signed };
}

export async function prepareWorkspaceForRepo(repoUrl: string, branch?: string) {
  return prepareRepoWorkspace(repoUrl, branch);
}
