import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DATA_DIR = process.env.REPODIET_DATA_DIR || path.join(process.cwd(), "data");
const ARTIFACTS_DIR = path.join(DATA_DIR, "artifacts");

export interface DurableDb {
  jobs: Record<string, unknown>;
  findings: Record<string, unknown>;
  patchKits: Record<string, unknown>;
  verifications: Record<string, unknown>;
  usage: Record<string, unknown>;
}

const DEFAULT_DB: DurableDb = {
  jobs: {},
  findings: {},
  patchKits: {},
  verifications: {},
  usage: {},
};

function ensureDirs(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(ARTIFACTS_DIR)) fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

function dbPath(): string {
  return path.join(DATA_DIR, "db.json");
}

export function durableId(prefix = "id"): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
}

export function durableNow(): string {
  return new Date().toISOString();
}

export function loadDurableDb(): DurableDb {
  ensureDirs();
  const fp = dbPath();
  if (!fs.existsSync(fp)) return structuredClone(DEFAULT_DB);
  try {
    const parsed = JSON.parse(fs.readFileSync(fp, "utf8")) as Partial<DurableDb>;
    return {
      jobs: parsed.jobs ?? {},
      findings: parsed.findings ?? {},
      patchKits: parsed.patchKits ?? {},
      verifications: parsed.verifications ?? {},
      usage: parsed.usage ?? {},
    };
  } catch {
    return structuredClone(DEFAULT_DB);
  }
}

export function saveDurableDb(db: DurableDb): void {
  ensureDirs();
  fs.writeFileSync(dbPath(), JSON.stringify(db, null, 2));
}

export async function withDurableDb<T>(fn: (db: DurableDb) => T | Promise<T>): Promise<T> {
  const db = loadDurableDb();
  const result = await fn(db);
  saveDurableDb(db);
  return result;
}

export function getDurableRecord<T>(collection: keyof DurableDb, id: string): T | undefined {
  const db = loadDurableDb();
  return db[collection][id] as T | undefined;
}

export function setDurableRecord(
  collection: keyof DurableDb,
  id: string,
  value: unknown
): void {
  withDurableDbSync((db) => {
    db[collection][id] = value;
  });
}

export function deleteDurableRecord(collection: keyof DurableDb, id: string): void {
  withDurableDbSync((db) => {
    delete db[collection][id];
  });
}

function withDurableDbSync(fn: (db: DurableDb) => void): void {
  const db = loadDurableDb();
  fn(db);
  saveDurableDb(db);
}

export function artifactPath(id: string, ext = "zip"): string {
  ensureDirs();
  return path.join(ARTIFACTS_DIR, `${id}.${ext}`);
}

export function writeArtifact(id: string, buffer: Buffer, ext = "zip"): string {
  const fp = artifactPath(id, ext);
  fs.writeFileSync(fp, buffer);
  return fp;
}

export function readArtifact(id: string, ext = "zip"): Buffer | null {
  const fp = artifactPath(id, ext);
  if (!fs.existsSync(fp)) return null;
  return fs.readFileSync(fp);
}

export function deleteArtifact(id: string, ext = "zip"): void {
  const fp = artifactPath(id, ext);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
}

export function isDurableStoreWritable(): boolean {
  try {
    ensureDirs();
    const probe = path.join(DATA_DIR, ".write-probe");
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}
