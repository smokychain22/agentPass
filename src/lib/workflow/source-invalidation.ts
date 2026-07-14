import { getA2ATask, updateA2ATask } from "@/lib/a2a/task-store";
import { getAppScan, storeAppScan } from "@/lib/scan/app-scan-store";
import { getStoredFindings } from "@/lib/findings/findings-store";
import { fetchBranchCommitSha } from "@/lib/github/fetch-repo-zip";
import { isKnownBaselineInvalidCommit } from "./baseline-readiness";

export type WorkflowInvalidationStatus = "invalid_source_baseline" | "stale_source_commit";

export interface WorkflowInvalidationMeta {
  status: WorkflowInvalidationStatus;
  retryable: false;
  requiresNewScan: true;
  reason: string;
  pinnedCommitSha?: string;
  currentCommitSha?: string;
  failedCheck?: string;
  classification?: string;
  invalidatedAt: string;
}

/** Audit records that must not reach Fix & PR again. */
const KNOWN_INVALID_SCAN_IDS = new Set([
  "scan_DymsApC3ZKMJ",
  "scan_CellDRLCZHAa",
]);

const KNOWN_INVALID_TASK_IDS = new Set([
  "task_61d1b67bbcf540",
  "task_647802f1c5dd49",
]);

export function isKnownInvalidScanId(scanId: string): boolean {
  return KNOWN_INVALID_SCAN_IDS.has(scanId);
}

export function isKnownInvalidTaskId(taskId: string): boolean {
  return KNOWN_INVALID_TASK_IDS.has(taskId);
}

export async function ensureScanInvalidationMetadata(scanId: string): Promise<WorkflowInvalidationMeta | null> {
  const scan = await getAppScan(scanId);
  const findings = await getStoredFindings(scanId);
  const pinnedCommit = findings?.repo.commitSha ?? scan?.payload?.repo?.commitSha;

  if (isKnownInvalidScanId(scanId) || (pinnedCommit && isKnownBaselineInvalidCommit(pinnedCommit))) {
    const meta: WorkflowInvalidationMeta = {
      status: "invalid_source_baseline",
      retryable: false,
      requiresNewScan: true,
      reason: "Repository baseline is invalid at the pinned source commit.",
      pinnedCommitSha: pinnedCommit,
      failedCheck: "npm run build",
      classification: "baseline_invalid",
      invalidatedAt: new Date().toISOString(),
    };
    if (scan && !scan.workflowMeta) {
      await storeAppScan(scanId, {
        payload: scan.payload,
        ownerKey: scan.ownerKey,
        workflowMeta: meta,
      });
    }
    return meta;
  }

  if (findings?.repo.owner && findings.repo.name && pinnedCommit) {
    const current = await fetchBranchCommitSha(
      findings.repo.owner,
      findings.repo.name,
      findings.repo.branch
    );
    if (current && current !== pinnedCommit) {
      const meta: WorkflowInvalidationMeta = {
        status: "stale_source_commit",
        retryable: false,
        requiresNewScan: true,
        reason: "Scan commit no longer matches repository HEAD.",
        pinnedCommitSha: pinnedCommit,
        currentCommitSha: current,
        classification: "stale_source_commit",
        invalidatedAt: new Date().toISOString(),
      };
      if (scan && !scan.workflowMeta) {
        await storeAppScan(scanId, {
          payload: scan.payload,
          ownerKey: scan.ownerKey,
          workflowMeta: meta,
        } as Parameters<typeof storeAppScan>[1] & { workflowMeta: WorkflowInvalidationMeta });
      }
      return meta;
    }
  }

  return scan?.workflowMeta ?? null;
}

export async function ensureTaskInvalidationMetadata(
  taskId: string
): Promise<WorkflowInvalidationMeta | null> {
  const task = await getA2ATask(taskId);
  if (!task) return null;

  if (isKnownInvalidTaskId(taskId)) {
    const meta: WorkflowInvalidationMeta = {
      status: "invalid_source_baseline",
      retryable: false,
      requiresNewScan: true,
      reason: "Task was created against a known baseline-invalid source commit.",
      pinnedCommitSha: task.input.commitSha ?? task.repository.commitSha,
      failedCheck: "npm run build",
      classification: "baseline_invalid",
      invalidatedAt: new Date().toISOString(),
    };
    if (!task.workflowMeta) {
      await updateA2ATask(taskId, { workflowMeta: meta });
    }
    return meta;
  }

  if (task.scanId) {
    const scanMeta = await ensureScanInvalidationMetadata(task.scanId);
    if (scanMeta) {
      if (!task.workflowMeta) {
        await updateA2ATask(taskId, { workflowMeta: scanMeta });
      }
      return scanMeta;
    }
  }

  const commit = task.input.commitSha ?? task.repository.commitSha;
  if (commit && isKnownBaselineInvalidCommit(commit)) {
    const meta: WorkflowInvalidationMeta = {
      status: "invalid_source_baseline",
      retryable: false,
      requiresNewScan: true,
      reason: "Repository baseline is invalid at the pinned source commit.",
      pinnedCommitSha: commit,
      failedCheck: "npm run build",
      classification: "baseline_invalid",
      invalidatedAt: new Date().toISOString(),
    };
    if (!task.workflowMeta) {
      await updateA2ATask(taskId, { workflowMeta: meta });
    }
    return meta;
  }

  return task.workflowMeta ?? null;
}

export function scanBlocksFixPr(meta: WorkflowInvalidationMeta | null | undefined): boolean {
  return Boolean(meta?.requiresNewScan);
}
