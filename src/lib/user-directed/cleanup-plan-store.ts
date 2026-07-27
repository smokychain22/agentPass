import { durableNow, getDurableRecord, setDurableRecord } from "@/lib/store/durable-store";

export type CleanupPlanStatus = "not_created" | "draft" | "ready_for_review" | "approved" | "superseded";

export interface CleanupPlanRecord {
  scanId: string;
  status: CleanupPlanStatus;
  pinnedCommit: string;
  includedFindingIds: string[];
  excludedFindingIds: string[];
  updatedAt: string;
}

/** Recomputing the plan while a prior one was approved supersedes it — approval never silently carries forward onto different selections. */
export async function saveDraftPlan(input: {
  scanId: string;
  pinnedCommit: string;
  includedFindingIds: string[];
  excludedFindingIds: string[];
}): Promise<CleanupPlanRecord> {
  const record: CleanupPlanRecord = {
    scanId: input.scanId,
    status: "draft",
    pinnedCommit: input.pinnedCommit,
    includedFindingIds: input.includedFindingIds,
    excludedFindingIds: input.excludedFindingIds,
    updatedAt: durableNow(),
  };
  await setDurableRecord("cleanup_plan_state", input.scanId, record);
  return record;
}

export async function getPlanState(scanId: string): Promise<CleanupPlanRecord | undefined> {
  return getDurableRecord<CleanupPlanRecord>("cleanup_plan_state", scanId);
}

/** Idempotent — approving an already-approved plan for the same scan/commit/selection is a no-op returning the same record. */
export async function approvePlan(input: {
  scanId: string;
  pinnedCommit: string;
  includedFindingIds: string[];
}): Promise<CleanupPlanRecord> {
  const existing = await getPlanState(input.scanId);
  if (
    existing &&
    existing.status === "approved" &&
    existing.pinnedCommit === input.pinnedCommit &&
    existing.includedFindingIds.length === input.includedFindingIds.length &&
    existing.includedFindingIds.every((id) => input.includedFindingIds.includes(id))
  ) {
    return existing;
  }
  if (!existing || existing.pinnedCommit !== input.pinnedCommit) {
    throw new Error("Cleanup plan must be prepared for this commit before it can be approved.");
  }
  const approved: CleanupPlanRecord = {
    ...existing,
    status: "approved",
    includedFindingIds: input.includedFindingIds,
    updatedAt: durableNow(),
  };
  await setDurableRecord("cleanup_plan_state", input.scanId, approved);
  return approved;
}

export function isPlanApprovedForCommit(
  plan: CleanupPlanRecord | undefined,
  pinnedCommit: string
): boolean {
  return Boolean(plan && plan.status === "approved" && plan.pinnedCommit === pinnedCommit);
}
