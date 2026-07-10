import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

function resolveDataDir(): string {
  if (process.env.REPODIET_DATA_DIR) {
    return process.env.REPODIET_DATA_DIR;
  }
  // Vercel/serverless: project dir is read-only — use /tmp
  if (process.env.VERCEL === "1" || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join(os.tmpdir(), "repodiet-data");
  }
  const local = path.join(process.cwd(), "data");
  try {
    if (!fs.existsSync(local)) fs.mkdirSync(local, { recursive: true });
    const probe = path.join(local, ".write-probe");
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
    return local;
  } catch {
    return path.join(os.tmpdir(), "repodiet-data");
  }
}

let cachedDataDir: string | null = null;

function dataDir(): string {
  if (!cachedDataDir) cachedDataDir = resolveDataDir();
  return cachedDataDir;
}

function artifactsDir(): string {
  return path.join(dataDir(), "artifacts");
}

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
  const root = dataDir();
  const artifacts = artifactsDir();
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  if (!fs.existsSync(artifacts)) fs.mkdirSync(artifacts, { recursive: true });
}

function dbPath(): string {
  return path.join(dataDir(), "db.json");
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
  return path.join(artifactsDir(), `${id}.${ext}`);
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
    const probe = path.join(dataDir(), ".write-probe");
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

export function getDataDir(): string {
  return dataDir();
}
