import fs from "node:fs";
import path from "node:path";
import { Redis } from "@upstash/redis";
import { isRedisPersistenceEnabled, localDurableRoot } from "@/lib/server/runtime-env";

export type PersistentCollection =
  | "jobs"
  | "findings"
  | "patchKits"
  | "verifications"
  | "usage"
  | "repositories"
  | "repository_snapshots"
  | "scans"
  | "cleanup_runs"
  | "cleanup_changes"
  | "verification_runs"
  | "task_quotes"
  | "payments"
  | "execution_receipts"
  | "github_installations"
  | "repository_policies"
  | "guard_runs";

export type ArtifactCollection = "artifacts";

export interface DurableDb {
  jobs: Record<string, unknown>;
  findings: Record<string, unknown>;
  patchKits: Record<string, unknown>;
  verifications: Record<string, unknown>;
  usage: Record<string, unknown>;
  repositories: Record<string, unknown>;
  repository_snapshots: Record<string, unknown>;
  scans: Record<string, unknown>;
  cleanup_runs: Record<string, unknown>;
  cleanup_changes: Record<string, unknown>;
  verification_runs: Record<string, unknown>;
  task_quotes: Record<string, unknown>;
  payments: Record<string, unknown>;
  execution_receipts: Record<string, unknown>;
  github_installations: Record<string, unknown>;
  repository_policies: Record<string, unknown>;
  guard_runs: Record<string, unknown>;
}

const DEFAULT_DB: DurableDb = {
  jobs: {},
  findings: {},
  patchKits: {},
  verifications: {},
  usage: {},
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
};

let redisClient: Redis | null = null;

function redis(): Redis | null {
  if (redisClient) return redisClient;
  if (!isRedisPersistenceEnabled()) return null;

  redisClient = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
  return redisClient;
}

function redisKey(collection: PersistentCollection | ArtifactCollection, id: string): string {
  return `repodiet:${collection}:${id}`;
}

function redisUsageKey(): string {
  return "repodiet:usage";
}

function localDbPath(): string {
  const root = localDurableRoot();
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }
  return path.join(root, "db.json");
}

function loadLocalDb(): DurableDb {
  const fp = localDbPath();
  if (!fs.existsSync(fp)) return structuredClone(DEFAULT_DB);
  try {
    const parsed = JSON.parse(fs.readFileSync(fp, "utf8")) as Partial<DurableDb>;
    return {
      jobs: parsed.jobs ?? {},
      findings: parsed.findings ?? {},
      patchKits: parsed.patchKits ?? {},
      verifications: parsed.verifications ?? {},
      usage: parsed.usage ?? {},
      repositories: parsed.repositories ?? {},
      repository_snapshots: parsed.repository_snapshots ?? {},
      scans: parsed.scans ?? {},
      cleanup_runs: parsed.cleanup_runs ?? {},
      cleanup_changes: parsed.cleanup_changes ?? {},
      verification_runs: parsed.verification_runs ?? {},
      task_quotes: parsed.task_quotes ?? {},
      payments: parsed.payments ?? {},
      execution_receipts: parsed.execution_receipts ?? {},
      github_installations: parsed.github_installations ?? {},
      repository_policies: parsed.repository_policies ?? {},
      guard_runs: parsed.guard_runs ?? {},
    };
  } catch {
    return structuredClone(DEFAULT_DB);
  }
}

function saveLocalDb(db: DurableDb): void {
  fs.writeFileSync(localDbPath(), JSON.stringify(db, null, 2));
}

export function persistenceBackend(): "redis" | "local" {
  return redis() ? "redis" : "local";
}

export async function getPersistentRecord<T>(
  collection: PersistentCollection,
  id: string
): Promise<T | undefined> {
  const client = redis();
  if (client) {
    return (await client.get<T>(redisKey(collection, id))) ?? undefined;
  }

  const db = loadLocalDb();
  return db[collection][id] as T | undefined;
}

export async function setPersistentRecord(
  collection: PersistentCollection,
  id: string,
  value: unknown
): Promise<void> {
  const client = redis();
  if (client) {
    await client.set(redisKey(collection, id), value);
    return;
  }

  const db = loadLocalDb();
  db[collection][id] = value;
  saveLocalDb(db);
}

export async function deletePersistentRecord(
  collection: PersistentCollection,
  id: string
): Promise<void> {
  const client = redis();
  if (client) {
    await client.del(redisKey(collection, id));
    return;
  }

  const db = loadLocalDb();
  delete db[collection][id];
  saveLocalDb(db);
}

export async function withPersistentUsage<T>(
  fn: (usage: Record<string, unknown>) => T | Promise<T>
): Promise<T> {
  const client = redis();
  if (client) {
    const current =
      (await client.get<Record<string, unknown>>(redisUsageKey())) ?? {};
    const result = await fn(current);
    await client.set(redisUsageKey(), current);
    return result;
  }

  const db = loadLocalDb();
  const result = await fn(db.usage);
  saveLocalDb(db);
  return result;
}

function localArtifactPath(id: string, ext = "zip"): string {
  const dir = path.join(localDurableRoot(), "artifacts");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${id}.${ext}`);
}

export async function writePersistentArtifact(
  id: string,
  buffer: Buffer,
  ext = "zip"
): Promise<void> {
  const client = redis();
  if (client) {
    await client.set(redisKey("artifacts", `${id}.${ext}`), buffer.toString("base64"));
    return;
  }

  fs.writeFileSync(localArtifactPath(id, ext), buffer);
}

export async function readPersistentArtifact(id: string, ext = "zip"): Promise<Buffer | null> {
  const client = redis();
  if (client) {
    const encoded = await client.get<string>(redisKey("artifacts", `${id}.${ext}`));
    if (!encoded || typeof encoded !== "string") return null;
    return Buffer.from(encoded, "base64");
  }

  const fp = localArtifactPath(id, ext);
  if (!fs.existsSync(fp)) return null;
  return fs.readFileSync(fp);
}

export async function deletePersistentArtifact(id: string, ext = "zip"): Promise<void> {
  const client = redis();
  if (client) {
    await client.del(redisKey("artifacts", `${id}.${ext}`));
    return;
  }

  const fp = localArtifactPath(id, ext);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
}
