import { randomUUID } from "node:crypto";
import {
  deletePersistentArtifact,
  deletePersistentRecord,
  getPersistentRecord,
  persistenceBackend,
  readPersistentArtifact,
  setPersistentRecord,
  setPersistentRecordIfAbsent,
  withPersistentUsage,
  writePersistentArtifact,
  type DurableDb,
  type PersistentCollection,
} from "@/lib/store/persistent-store";
import { isRedisPersistenceEnabled, localDurableRoot } from "@/lib/server/runtime-env";

export type { DurableDb };

export function durableId(prefix = "id"): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
}

export function durableNow(): string {
  return new Date().toISOString();
}

export async function getDurableRecord<T>(
  collection: PersistentCollection,
  id: string
): Promise<T | undefined> {
  return getPersistentRecord<T>(collection, id);
}

export async function setDurableRecord(
  collection: PersistentCollection,
  id: string,
  value: unknown
): Promise<void> {
  await setPersistentRecord(collection, id, value);
}

export async function setDurableRecordIfAbsent(
  collection: PersistentCollection,
  id: string,
  value: unknown
): Promise<boolean> {
  return setPersistentRecordIfAbsent(collection, id, value);
}

export async function deleteDurableRecord(
  collection: PersistentCollection,
  id: string
): Promise<void> {
  await deletePersistentRecord(collection, id);
}

export async function withDurableDb<T>(
  fn: (db: DurableDb) => T | Promise<T>
): Promise<T> {
  return withPersistentUsage(async (usage) => {
    const db: DurableDb = {
      jobs: {},
      findings: {},
      patchKits: {},
      patchKitsByScan: {},
      verifications: {},
      usage,
      repositories: {},
      repository_snapshots: {},
      scans: {},
      cleanup_runs: {},
      cleanup_changes: {},
      verification_runs: {},
      task_quotes: {},
      payments: {},
      execution_receipts: {},
      github_installations: {},
      repository_policies: {},
      guard_runs: {},
      tasks: {},
      a2a_tasks: {},
      okx_orders: {},
      marketplace_deliveries: {},
      payment_entitlements: {},
      asp_jobs: {},
      repository_jobs: {},
      worker_instances: {},
    };
    return fn(db);
  });
}

export async function writeArtifact(id: string, buffer: Buffer, ext = "zip"): Promise<void> {
  await writePersistentArtifact(id, buffer, ext);
}

export async function readArtifact(id: string, ext = "zip"): Promise<Buffer | null> {
  return readPersistentArtifact(id, ext);
}

export async function deleteArtifact(id: string, ext = "zip"): Promise<void> {
  await deletePersistentArtifact(id, ext);
}

export function getDataDir(): string {
  return localDurableRoot();
}

export function isDurableStoreWritable(): boolean {
  return isRedisPersistenceEnabled() || persistenceBackend() === "local";
}

export { persistenceBackend, isRedisPersistenceEnabled };
