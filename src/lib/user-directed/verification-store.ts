import { getDurableRecord, setDurableRecord } from "@/lib/store/durable-store";

export type VerificationCheckType = "reference_search";
export type VerificationResult = "passed" | "failed";

export interface VerificationRecord {
  verificationId: string;
  scanId: string;
  findingId: string;
  checkType: VerificationCheckType;
  command: string;
  startedAt: string;
  completedAt: string;
  exitCode: number;
  result: VerificationResult;
  /** Bounded, real command output/summary — never fabricated. */
  resultSummary: string;
  commitSha?: string;
}

function key(scanId: string, findingId: string): string {
  return `${scanId}:${findingId}`;
}

function indexKey(scanId: string): string {
  return `${scanId}:__index__`;
}

/** Appends a real verification record — history is preserved, never overwritten. */
export async function appendVerificationRecord(record: VerificationRecord): Promise<void> {
  const existing =
    (await getDurableRecord<VerificationRecord[]>(
      "finding_verifications",
      key(record.scanId, record.findingId)
    )) ?? [];
  await setDurableRecord("finding_verifications", key(record.scanId, record.findingId), [
    ...existing,
    record,
  ]);

  const index =
    (await getDurableRecord<string[]>("finding_verifications", indexKey(record.scanId))) ?? [];
  if (!index.includes(record.findingId)) {
    await setDurableRecord("finding_verifications", indexKey(record.scanId), [
      ...index,
      record.findingId,
    ]);
  }
}

export async function listVerificationRecords(
  scanId: string,
  findingId: string
): Promise<VerificationRecord[]> {
  return (
    (await getDurableRecord<VerificationRecord[]>(
      "finding_verifications",
      key(scanId, findingId)
    )) ?? []
  );
}

export async function listAllVerificationRecordsForScan(
  scanId: string
): Promise<VerificationRecord[]> {
  const index = (await getDurableRecord<string[]>("finding_verifications", indexKey(scanId))) ?? [];
  const perFinding = await Promise.all(index.map((findingId) => listVerificationRecords(scanId, findingId)));
  return perFinding.flat();
}
