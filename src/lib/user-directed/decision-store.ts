import { durableNow, getDurableRecord, setDurableRecord } from "@/lib/store/durable-store";

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

export async function listFindingDecisions(scanId: string): Promise<FindingDecisionRecord[]> {
  const index = (await getDurableRecord<string[]>("finding_decisions", indexKey(scanId))) ?? [];
  const records = await Promise.all(
    index.map((findingId) => getFindingDecision(scanId, findingId))
  );
  return records.filter((r): r is FindingDecisionRecord => Boolean(r));
}
