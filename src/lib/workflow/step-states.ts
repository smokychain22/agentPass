import type { FindingsPayload } from "@/lib/findings/types";
import type { ScanPayload } from "@/lib/scanner/run-scan";
import type { WorkflowA2ATask } from "@/lib/workflow/client";
import { isActionableFinding } from "@/lib/findings/actionability-signals";
import { flattenFindings } from "@/lib/findings/client";

/** Product workflow step IDs (authoritative). */
export type WorkflowStepId = "connect" | "findings" | "cleanup_pr" | "review_accept";

/** UI tab IDs used by /app routing. */
export type WorkflowTabId = "scan" | "findings" | "patch" | "verify";

/**
 * current  — primary next action (cyan)
 * running  — in progress (spinner, no check)
 * complete — real backend-backed completion (green check)
 * locked   — unavailable (lock icon)
 * failed   — recoverable error (no check)
 * inactive — unlocked/available but not the primary current step (no check)
 */
export type WorkflowStepStatus =
  | "current"
  | "running"
  | "complete"
  | "locked"
  | "failed"
  | "inactive";

export type WorkflowStepState = {
  id: WorkflowStepId;
  tabId: WorkflowTabId;
  status: WorkflowStepStatus;
  title: string;
  explanation?: string;
  primaryAction?: string;
};

export type ScanLifecyclePhase = "idle" | "running" | "failed" | "complete";
export type FindingsLifecyclePhase = "idle" | "running" | "failed" | "complete";

const PR_EXECUTING = new Set([
  "funded",
  "generating_changes",
  "validating_patch",
  "creating_branch",
  "verifying",
  "creating_pull_request",
  "awaiting_approval",
  "awaiting_payment",
]);

const ACCEPTANCE_COMPLETE = new Set([
  "buyer_accepted",
  "escrow_released",
  "completed",
]);

const ACCEPTANCE_RUNNING = new Set([
  "monitoring_checks",
  "checks_failed",
  "diagnosis_ready",
  "owner_action_required",
  "delivery_ready",
  "delivery_submitted",
]);

export const TAB_TO_STEP: Record<WorkflowTabId, WorkflowStepId> = {
  scan: "connect",
  findings: "findings",
  patch: "cleanup_pr",
  verify: "review_accept",
};

export const STEP_TO_TAB: Record<WorkflowStepId, WorkflowTabId> = {
  connect: "scan",
  findings: "findings",
  cleanup_pr: "patch",
  review_accept: "verify",
};

export interface WorkflowStepInput {
  scanResult: ScanPayload | null;
  scanComplete: boolean;
  scanRecordId?: string;
  projectRootConfirmed?: boolean;
  scanPhase?: ScanLifecyclePhase;
  findings: FindingsPayload | null;
  findingsPhase?: FindingsLifecyclePhase;
  selectedFindingIds?: string[];
  scopeReviewed?: boolean;
  a2aTask?: WorkflowA2ATask | null;
  /** Active UI tab — prefers this unlocked step as "current" when appropriate. */
  activeTab?: WorkflowTabId;
}

function normalizeRepoKey(owner?: string, name?: string): string {
  return `${(owner ?? "").trim().toLowerCase()}/${(name ?? "").trim().toLowerCase()}`;
}

/** Real backend-backed repository connection (not typing a URL). */
export function isRepositoryConnected(input: {
  scanResult: ScanPayload | null;
  scanComplete: boolean;
  scanRecordId?: string;
}): boolean {
  if (!input.scanComplete) return false;
  const scan = input.scanResult;
  if (!scan) return false;
  const owner = scan.repo?.owner?.trim();
  const name = scan.repo?.name?.trim();
  const branch = scan.repo?.branch?.trim();
  const commitSha = scan.repo?.commitSha?.trim();
  const scanId = (scan.id || input.scanRecordId || "").trim();
  return Boolean(owner && name && branch && commitSha && scanId);
}

/** Findings must belong to the active scan repository + commit. */
export function isFindingsBoundToActiveScan(input: {
  scanResult: ScanPayload | null;
  scanComplete: boolean;
  scanRecordId?: string;
  findings: FindingsPayload | null;
}): boolean {
  if (!isRepositoryConnected(input) || !input.findings) return false;
  const scan = input.scanResult!;
  const findings = input.findings;
  const scanId = (scan.id || input.scanRecordId || "").trim();
  if (findings.scanId && scanId && findings.scanId !== scanId) return false;
  if (
    normalizeRepoKey(findings.repo.owner, findings.repo.name) !==
    normalizeRepoKey(scan.repo.owner, scan.repo.name)
  ) {
    return false;
  }
  const findingsCommit = findings.repo.commitSha?.trim();
  const scanCommit = scan.repo.commitSha?.trim();
  if (findingsCommit && scanCommit && findingsCommit !== scanCommit) return false;
  if (findings.repo.branch && scan.repo.branch && findings.repo.branch !== scan.repo.branch) {
    return false;
  }
  return true;
}

function safeIsActionable(finding: Parameters<typeof isActionableFinding>[0]): boolean {
  try {
    return isActionableFinding(finding);
  } catch {
    return false;
  }
}

function hasZeroMaintenanceFindings(findings: FindingsPayload): boolean {
  const flat = flattenFindings(findings);
  const actionable = flat.filter(safeIsActionable).length;
  const total = findings.summary?.totalFindings ?? flat.length;
  return total === 0 || actionable === 0;
}

/**
 * Findings step is complete only after a real bound analysis result exists and
 * the buyer reviewed/continued — or the analysis truthfully returned no supported work.
 */
export function isFindingsStepComplete(input: {
  scanResult: ScanPayload | null;
  scanComplete: boolean;
  scanRecordId?: string;
  findings: FindingsPayload | null;
  scopeReviewed?: boolean;
}): boolean {
  if (!isFindingsBoundToActiveScan(input) || !input.findings) return false;
  if (input.scopeReviewed) return true;
  return hasZeroMaintenanceFindings(input.findings);
}

function taskMatchesActiveRepository(input: {
  scanResult: ScanPayload | null;
  a2aTask?: WorkflowA2ATask | null;
}): boolean {
  const task = input.a2aTask;
  const scan = input.scanResult;
  if (!task || !scan) return false;
  if (
    normalizeRepoKey(task.repository.owner, task.repository.name) !==
    normalizeRepoKey(scan.repo.owner, scan.repo.name)
  ) {
    return false;
  }
  if (
    task.repository.commitSha &&
    scan.repo.commitSha &&
    task.repository.commitSha !== scan.repo.commitSha
  ) {
    return false;
  }
  return true;
}

/** Real GitHub PR delivery for the active repository. */
export function isCleanupPrComplete(input: {
  scanResult: ScanPayload | null;
  a2aTask?: WorkflowA2ATask | null;
}): boolean {
  const task = input.a2aTask;
  if (!task || !taskMatchesActiveRepository(input)) return false;
  const prNumber = task.pullRequest?.number ?? task.prDelivery?.prNumber;
  const prUrl = task.pullRequest?.url ?? task.prDelivery?.prUrl;
  return Boolean(task.taskId && prNumber && prUrl);
}

export function isCleanupPrRunning(input: {
  scanResult: ScanPayload | null;
  a2aTask?: WorkflowA2ATask | null;
}): boolean {
  const task = input.a2aTask;
  if (!task || !taskMatchesActiveRepository(input)) return false;
  if (isCleanupPrComplete(input)) return false;
  return PR_EXECUTING.has(task.status);
}

export function isReviewAcceptComplete(input: {
  scanResult: ScanPayload | null;
  a2aTask?: WorkflowA2ATask | null;
}): boolean {
  const task = input.a2aTask;
  if (!task || !taskMatchesActiveRepository(input)) return false;
  if (!isCleanupPrComplete(input)) return false;
  if (ACCEPTANCE_COMPLETE.has(task.status)) return true;
  return Boolean(task.settlement?.buyerAcceptedAt || task.settlement?.escrowReleasedAt);
}

export function isReviewAcceptRunning(input: {
  scanResult: ScanPayload | null;
  a2aTask?: WorkflowA2ATask | null;
}): boolean {
  const task = input.a2aTask;
  if (!task || !taskMatchesActiveRepository(input)) return false;
  if (isReviewAcceptComplete(input)) return false;
  return ACCEPTANCE_RUNNING.has(task.status);
}

function selectedActionableCount(
  findings: FindingsPayload | null,
  selectedFindingIds: string[]
): number {
  if (!findings) return 0;
  const selected = new Set(selectedFindingIds);
  return flattenFindings(findings).filter((f) => selected.has(f.id) && safeIsActionable(f)).length;
}

function pickCurrentStep(
  steps: WorkflowStepState[],
  activeStepId?: WorkflowStepId
): WorkflowStepState[] {
  const open = steps.filter(
    (s) => s.status === "current" || s.status === "inactive"
  );
  if (open.length === 0) return steps;

  const preferred =
    (activeStepId && open.find((s) => s.id === activeStepId)) ||
    open.find((s) => s.status === "current") ||
    open[0];

  return steps.map((step) => {
    if (step.status !== "current" && step.status !== "inactive") return step;
    if (step.id === preferred.id) return { ...step, status: "current" };
    return { ...step, status: "inactive" };
  });
}

/**
 * Single authoritative workflow step resolver for sidebar + top rail.
 * Green checks only when real backend-backed completion conditions are met.
 */
export function resolveWorkflowStepStates(input: WorkflowStepInput): WorkflowStepState[] {
  const projectRootConfirmed = input.projectRootConfirmed ?? true;
  const selectedFindingIds = input.selectedFindingIds ?? [];
  const scanPhase = input.scanPhase ?? (input.scanComplete ? "complete" : "idle");
  const findingsPhase = input.findingsPhase ?? "idle";
  const activeStepId = input.activeTab ? TAB_TO_STEP[input.activeTab] : undefined;

  const repositoryConnected = isRepositoryConnected(input);
  const findingsBound = isFindingsBoundToActiveScan(input);
  const findingsComplete = isFindingsStepComplete(input);
  const actionableSelected = selectedActionableCount(input.findings, selectedFindingIds);
  const zeroFindings = findingsBound && input.findings
    ? hasZeroMaintenanceFindings(input.findings)
    : false;

  const cleanupPrUnlocked =
    findingsComplete && (actionableSelected > 0 || zeroFindings);

  const prComplete = isCleanupPrComplete(input);
  const prRunning = isCleanupPrRunning(input);
  const acceptComplete = isReviewAcceptComplete(input);
  const acceptRunning = isReviewAcceptRunning(input);

  const connect: WorkflowStepState = {
    id: "connect",
    tabId: "scan",
    title: "Connect Repository",
    status: "locked",
  };
  const findings: WorkflowStepState = {
    id: "findings",
    tabId: "findings",
    title: "Review Findings",
    status: "locked",
    explanation:
      "Review Findings becomes available after RepoDiet successfully scans and pins the repository commit.",
  };
  const cleanup: WorkflowStepState = {
    id: "cleanup_pr",
    tabId: "patch",
    title: "Create Cleanup PR",
    status: "locked",
    explanation:
      "Create Cleanup PR unlocks after findings are reviewed and a valid cleanup scope is confirmed.",
  };
  const accept: WorkflowStepState = {
    id: "review_accept",
    tabId: "verify",
    title: "Review & Accept",
    status: "locked",
    explanation: "Review & Accept unlocks after a real cleanup pull request has been created.",
  };

  // Connect
  if (scanPhase === "running") {
    connect.status = "running";
    connect.primaryAction = "Scanning repository…";
  } else if (scanPhase === "failed" && !repositoryConnected) {
    connect.status = "failed";
    connect.primaryAction = "Retry scan";
    connect.explanation = "Repository scan failed. Fix the URL or branch and scan again.";
  } else if (repositoryConnected) {
    connect.status = "complete";
  } else {
    connect.status = "current";
    connect.primaryAction = "Scan Repository";
  }

  // Findings
  if (!repositoryConnected || !projectRootConfirmed) {
    findings.status = "locked";
    findings.explanation = !repositoryConnected
      ? "Review Findings becomes available after RepoDiet successfully scans and pins the repository commit."
      : "Select which application RepoDiet should analyze.";
  } else if (findingsPhase === "running") {
    findings.status = "running";
    findings.primaryAction = "Analyzing findings…";
  } else if (findingsPhase === "failed" && !findingsBound) {
    findings.status = "failed";
    findings.primaryAction = "Retry findings analysis";
  } else if (findingsComplete) {
    findings.status = "complete";
    if (zeroFindings) {
      findings.explanation =
        "Analysis complete — no supported maintenance findings were detected.";
    }
  } else {
    findings.status = "current";
    findings.primaryAction = "Review findings";
    if (findingsBound && zeroFindings) {
      findings.explanation =
        "Analysis complete — no supported maintenance findings were detected.";
    }
  }

  // Create Cleanup PR
  if (!findingsComplete) {
    cleanup.status = "locked";
  } else if (!cleanupPrUnlocked) {
    cleanup.status = "locked";
    cleanup.explanation =
      "Select at least one supported actionable finding before creating a cleanup pull request.";
  } else if (prComplete) {
    cleanup.status = "complete";
  } else if (prRunning) {
    cleanup.status = "running";
    cleanup.primaryAction = "Creating cleanup pull request…";
  } else if (
    input.a2aTask &&
    taskMatchesActiveRepository(input) &&
    (input.a2aTask.status === "delivery_failed" ||
      input.a2aTask.status === "verification_failed" ||
      input.a2aTask.status === "analysis_failed")
  ) {
    cleanup.status = "failed";
    cleanup.primaryAction = "Start a new cleanup attempt";
    cleanup.explanation = input.a2aTask.error || "Cleanup pull request delivery failed.";
  } else {
    cleanup.status = "current";
    cleanup.primaryAction = "Create Cleanup PR";
  }

  // Review & Accept
  if (!prComplete) {
    accept.status = "locked";
  } else if (acceptComplete) {
    accept.status = "complete";
  } else if (acceptRunning) {
    accept.status = "running";
    accept.primaryAction = "Monitoring delivery checks…";
  } else {
    accept.status = "current";
    accept.primaryAction = "Review delivery";
  }

  return pickCurrentStep([connect, findings, cleanup, accept], activeStepId);
}

/** Convenience map for consumers keyed by product step id. */
export function workflowStepMap(
  steps: WorkflowStepState[]
): Record<WorkflowStepId, WorkflowStepState> {
  return {
    connect: steps.find((s) => s.id === "connect")!,
    findings: steps.find((s) => s.id === "findings")!,
    cleanup_pr: steps.find((s) => s.id === "cleanup_pr")!,
    review_accept: steps.find((s) => s.id === "review_accept")!,
  };
}
