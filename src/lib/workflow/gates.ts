import type { FindingsPayload } from "@/lib/findings/types";
import type { PatchKitPayload } from "@/lib/patch-kit/types";
import { countEligibleFindings } from "@/lib/findings/actionability-signals";
import { isCleanupEligible as isCleanupEligibleFinding } from "@/lib/findings/cleanup-eligibility";
import { flattenFindings } from "@/lib/findings/client";
import type { RepositoryConnectionStatus } from "./github-repository-status";
import { resolveFixPrUnlock } from "./unlock-reasons";

export type QuickCleanupWorkflowState =
  | "inactive"
  | "running"
  | "blocked"
  | "failed"
  | "complete";

export type A2AWorkflowPhase =
  | "inactive"
  | "scope_ready"
  | "quote_required"
  | "payment_pending"
  | "funded"
  | "executing"
  | "delivery_ready"
  | "completed"
  | "failed";

export interface WorkflowA2ATaskSnapshot {
  id: string;
  status: string;
}

const EXECUTING_STATUSES = new Set([
  "funded",
  "generating_changes",
  "validating_patch",
  "creating_branch",
  "verifying",
  "creating_pull_request",
  "awaiting_approval",
]);

const REVIEWABLE_STATUSES = new Set([
  "monitoring_checks",
  "checks_failed",
  "diagnosis_ready",
  "owner_action_required",
  "delivery_ready",
  "delivery_submitted",
  "buyer_accepted",
  "escrow_released",
  "completed",
]);

export interface WorkflowGates {
  scanComplete: boolean;
  projectRootConfirmed: boolean;
  findingsUnlocked: boolean;
  findingsReady: boolean;
  eligibleFindingsCount: number;
  safeCandidateCount: number;
  reviewFirstCount: number;
  transformedFindingsCount: number;
  /** @deprecated */
  transformerCompatibleCount: number;
  /** @deprecated */
  dryRunPassedCount: number;
  supportedFixCount: number;
  quickCleanupAvailable: boolean;
  quickCleanupState: QuickCleanupWorkflowState;
  patchKitReady: boolean;
  generatedChanges: number;
  validatedChanges: number;
  verifiedChanges: number;
  patchValidated: boolean;
  verifyUnlocked: boolean;
  verificationPassed: boolean;
  cleanupPrAvailable: boolean;
  reportOnlyPrAvailable: boolean;
  fixPrUnlocked: boolean;
  fixPrLockTitle: string;
  fixPrLockBody: string;
  fixPrPrimaryAction?: string;
  fixPrSecondaryAction?: string;
  githubConnected: boolean;
  a2aPhase: A2AWorkflowPhase;
  a2aTaskId?: string;
}

function mapA2aPhase(task: WorkflowA2ATaskSnapshot | null | undefined): A2AWorkflowPhase {
  if (!task) return "inactive";
  switch (task.status) {
    case "quote_required":
      return "quote_required";
    case "awaiting_payment":
      return "payment_pending";
    case "funded":
      return "funded";
    case "completed":
      return "completed";
    case "payment_failed":
    case "verification_failed":
    case "delivery_failed":
    case "analysis_failed":
      return "failed";
    default:
      if (EXECUTING_STATUSES.has(task.status)) return "executing";
      if (REVIEWABLE_STATUSES.has(task.status)) return "delivery_ready";
      return "scope_ready";
  }
}

export function computeWorkflowGates(input: {
  scanComplete: boolean;
  projectRootConfirmed?: boolean;
  findings: FindingsPayload | null;
  patchKit: PatchKitPayload | null;
  quickCleanupRunning?: boolean;
  verificationStatus?: "passed" | "failed" | "partial" | "not_run" | null;
  commitSha?: string;
  githubStatus?: RepositoryConnectionStatus | null;
  selectedFindingIds?: string[];
  scopeReviewed?: boolean;
  a2aTask?: WorkflowA2ATaskSnapshot | null;
  workerAvailable?: boolean;
  commitStale?: boolean;
}): WorkflowGates {
  const findings = input.findings;
  const patchKit = input.patchKit;
  const projectRootConfirmed = input.projectRootConfirmed ?? true;
  const selectedFindingIds = input.selectedFindingIds ?? [];

  const flat = findings ? flattenFindings(findings) : [];
  const eligibleFindingsCount =
    findings?.summary.eligibleFindings ?? countEligibleFindings(flat);
  const safeCandidateCount = flat.filter((f) => f.action === "safe_candidate").length;
  const cleanupEligibleCount = countEligibleFindings(flat);
  const reviewFirstCount = flat.filter((f) => f.action === "review_first").length;
  const transformedFindingsCount = findings?.summary.transformedFindings ?? 0;
  const supportedFixCount = cleanupEligibleCount;
  const findingsReady = Boolean(findings);
  const findingsUnlocked = input.scanComplete && projectRootConfirmed;

  const selectedSafeCount = flat.filter(
    (f) => selectedFindingIds.includes(f.id) && isCleanupEligibleFinding(f)
  ).length;

  const githubConnected = Boolean(input.githubStatus?.connected);
  const fixPrUnlock = resolveFixPrUnlock({
    scanComplete: input.scanComplete,
    commitSha: input.commitSha ?? findings?.repo?.commitSha,
    github: input.githubStatus ?? null,
    selectedFindingIds,
    safeCandidateCount: selectedSafeCount,
    scopeReviewed: input.scopeReviewed,
    workerAvailable: input.workerAvailable,
    commitStale: input.commitStale,
  });

  const a2aPhase = mapA2aPhase(input.a2aTask);
  const a2aActive = a2aPhase !== "inactive" && a2aPhase !== "failed";

  const generatedChanges = patchKit?.summary.generatedChanges ?? 0;
  const validatedChanges = patchKit?.summary.validatedChanges ?? 0;
  const verifiedChanges = patchKit?.summary.verifiedChanges ?? 0;
  const patchValidated = patchKit?.patchValidation?.status === "passed";
  const sandboxPending = patchKit?.patchValidation?.status === "pending_sandbox";
  const repositoryVerified = patchKit?.repositoryVerification?.status === "verified";
  const verificationPassed =
    input.verificationStatus === "passed" ||
    repositoryVerified ||
    input.a2aTask?.status === "completed";
  const patchKitReady = Boolean(patchKit?.id);

  let quickCleanupState: QuickCleanupWorkflowState = "inactive";
  if (input.quickCleanupRunning) {
    quickCleanupState = "running";
  } else if (patchKitReady) {
    if (sandboxPending) {
      quickCleanupState = "running";
    } else if (validatedChanges > 0 && patchValidated) {
      quickCleanupState = "complete";
    } else if (generatedChanges === 0 && validatedChanges === 0) {
      quickCleanupState = "failed";
    } else {
      quickCleanupState = "blocked";
    }
  }

  const fixPrUnlocked = fixPrUnlock.unlocked || a2aActive;
  const verifyFromA2a =
    Boolean(input.a2aTask) &&
    (EXECUTING_STATUSES.has(input.a2aTask!.status) ||
      REVIEWABLE_STATUSES.has(input.a2aTask!.status) ||
      input.a2aTask!.status === "awaiting_approval");

  return {
    scanComplete: input.scanComplete,
    projectRootConfirmed,
    findingsUnlocked,
    findingsReady,
    eligibleFindingsCount,
    safeCandidateCount,
    reviewFirstCount,
    transformedFindingsCount,
    transformerCompatibleCount: eligibleFindingsCount,
    dryRunPassedCount: transformedFindingsCount,
    supportedFixCount,
    quickCleanupAvailable: findingsReady && cleanupEligibleCount > 0,
    quickCleanupState,
    patchKitReady,
    generatedChanges,
    validatedChanges,
    verifiedChanges,
    patchValidated,
    verifyUnlocked:
      verifyFromA2a ||
      (patchKitReady && patchValidated && validatedChanges > 0),
    verificationPassed,
    cleanupPrAvailable:
      patchKitReady &&
      patchValidated &&
      validatedChanges > 0 &&
      generatedChanges > 0 &&
      verificationPassed &&
      !sandboxPending,
    reportOnlyPrAvailable: findingsReady,
    fixPrUnlocked,
    fixPrLockTitle: fixPrUnlock.title,
    fixPrLockBody: fixPrUnlock.body,
    fixPrPrimaryAction: fixPrUnlock.primaryAction,
    fixPrSecondaryAction: fixPrUnlock.secondaryAction,
    githubConnected,
    a2aPhase,
    a2aTaskId: input.a2aTask?.id,
  };
}
