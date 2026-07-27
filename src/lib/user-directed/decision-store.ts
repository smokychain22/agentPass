import { createHash } from "node:crypto";
import { deleteDurableRecord, durableNow, getDurableRecord, setDurableRecord } from "@/lib/store/durable-store";

export type FindingDecisionState =
  | "undecided"
  | "selected"
  | "kept"
  | "excluded"
  | "verification_requested"
  | "verified_selected"
  | "verified_kept";

export interface FindingDecisionRecord {
  findingId: string;
  scanId: string;
  analyzedCommit?: string;
  decision: FindingDecisionState;
  canonicalFile?: string;
  filesToRemove?: string[];
  filesToKeep?: string[];
  referencesToUpdate?: string[];
  /** True when the user explicitly overrode RepoDiet's own recommendation (e.g. removing an unverified finding anyway). */
  isOverride?: boolean;
  verificationStatus?: "not_requested" | "requested" | "verified" | "failed";
  decisionTimestamp: string;
}

function recordKey(scanId: string, findingId: string): string {
  return `${scanId}:${findingId}`;
}

function indexKey(scanId: string): string {
  return `${scanId}:__index__`;
}

/** Idempotent upsert — repeated identical decisions overwrite the same record, never duplicate it. */
export async function saveFindingDecision(
  input: Omit<FindingDecisionRecord, "decisionTimestamp">
): Promise<FindingDecisionRecord> {
  const record: FindingDecisionRecord = {
    ...input,
    decisionTimestamp: durableNow(),
  };
  await setDurableRecord("finding_decisions", recordKey(input.scanId, input.findingId), record);

  const index =
    (await getDurableRecord<string[]>("finding_decisions", indexKey(input.scanId))) ?? [];
  if (!index.includes(input.findingId)) {
    await setDurableRecord("finding_decisions", indexKey(input.scanId), [
      ...index,
      input.findingId,
    ]);
  }

  return record;
}

export async function getFindingDecision(
  scanId: string,
  findingId: string
): Promise<FindingDecisionRecord | undefined> {
  return getDurableRecord<FindingDecisionRecord>("finding_decisions", recordKey(scanId, findingId));
}

/** Removes a single persisted decision (Undo). Idempotent — clearing an already-cleared finding is a no-op. */
export async function clearFindingDecision(scanId: string, findingId: string): Promise<void> {
  await deleteDurableRecord("finding_decisions", recordKey(scanId, findingId));
  const index =
    (await getDurableRecord<string[]>("finding_decisions", indexKey(scanId))) ?? [];
  if (index.includes(findingId)) {
    await setDurableRecord(
      "finding_decisions",
      indexKey(scanId),
      index.filter((id) => id !== findingId)
    );
  }
}

export async function listFindingDecisions(scanId: string): Promise<FindingDecisionRecord[]> {
  const index = (await getDurableRecord<string[]>("finding_decisions", indexKey(scanId))) ?? [];
  const records = await Promise.all(
    index.map((findingId) => getFindingDecision(scanId, findingId))
  );
  return records.filter((r): r is FindingDecisionRecord => Boolean(r));
}

/**
 * A stable fingerprint of the current decision set. An approved cleanup plan
 * stores the fingerprint it was approved against; if any decision changes
 * afterward, the live fingerprint no longer matches and the plan is stale
 * (superseded) — computed the same way server-side everywhere, so the client
 * can never "disagree" with the persisted plan by drifting local state.
 */
export function computeDecisionsFingerprint(decisions: FindingDecisionRecord[]): string {
  const sorted = [...decisions]
    .map((d) => `${d.findingId}:${d.decision}:${d.canonicalFile ?? ""}`)
    .sort();
  return createHash("sha256").update(sorted.join("|")).digest("hex").slice(0, 32);
}
