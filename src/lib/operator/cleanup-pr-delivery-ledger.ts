import { getDurableRecord, setDurableRecord } from "@/lib/store/durable-store";

export interface CleanupPrDeliveryRecord {
  owner: string;
  repo: string;
  prNumber: number;
  branch: string;
  deliveredAt: string;
}

/**
 * Records which branch and pull request a given patch kit was last
 * delivered to, keyed by the patch kit's own id — never by anything the
 * caller supplies, since a caller-supplied key could be reused across
 * unrelated requests.
 *
 * === Idempotency defect this exists to close ===
 * Every `/api/patch-kit/generate` call mints a brand-new `patchKit.id`, so
 * a repeated *delivery* request naturally carries the SAME patchKitId. But
 * `createCleanupPullRequest` had no memory of a prior delivery for that id:
 * `input.cleanupBranch` defaults to `buildCleanupBranchName()` — a fresh
 * random name — on every call, and `input.existingPrNumber` (the flag that
 * already drives same-PR reuse via `resolvePrRepairStrategy`) was only ever
 * populated by callers that track their own task state (the paid A2A
 * orchestrator, phase3, the ASP executor). The manual/free
 * `/api/github/create-cleanup-pr` route tracks nothing, so an identical
 * redelivery request created a second branch and a second PR.
 *
 * Reproduced live: submitting the same `{patchKitId, scanId, approvedPaths}`
 * twice against `velz-cmd/repodiet-e2e-test` opened PR #3 and then PR #4 for
 * the exact same one-line deletion.
 *
 * Fix: `createCleanupPullRequest` looks up this ledger by `patchKit.id`
 * before falling back to a fresh branch name, and supplies the recorded
 * `prNumber`/`branch` as `existingPrNumber`/`cleanupBranch` when the caller
 * didn't already supply its own — routing the retry through the exact same
 * `resolvePrRepairStrategy` reuse-vs-replace logic the paid flow already
 * relies on, rather than inventing a second reuse mechanism. Only engages
 * when the caller has no tracking of its own, so the three callers that
 * already pass `existingPrNumber` are unaffected.
 */
export async function getCleanupPrDelivery(
  patchKitId: string
): Promise<CleanupPrDeliveryRecord | undefined> {
  return getDurableRecord<CleanupPrDeliveryRecord>("cleanup_pr_deliveries", patchKitId);
}

export async function recordCleanupPrDelivery(
  patchKitId: string,
  record: Omit<CleanupPrDeliveryRecord, "deliveredAt">
): Promise<void> {
  await setDurableRecord("cleanup_pr_deliveries", patchKitId, {
    ...record,
    deliveredAt: new Date().toISOString(),
  });
}
