import { Redis } from "@upstash/redis";
import { isRedisPersistenceEnabled } from "@/lib/server/runtime-env";
import {
  getPersistentRecord,
  setPersistentRecord,
} from "@/lib/store/persistent-store";

const DEEP_SCAN_QUEUE_KEY = "repodiet:deep_scan_jobs:queue";
const COLLECTION = "deep_scan_jobs" as const;
const LEGACY_QUEUE_KEY = "queue:list";

let redisClient: Redis | null = null;
/** Serializes local (non-Redis) dequeue/enqueue to prevent double-claim in-process. */
let localQueueLock: Promise<void> = Promise.resolve();

function redis(): Redis | null {
  if (redisClient) return redisClient;
  if (!isRedisPersistenceEnabled()) return null;
  redisClient = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
  return redisClient;
}

async function withLocalQueueLock<T>(fn: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const prev = localQueueLock;
  localQueueLock = prev.then(() => gate);
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

/** Atomic enqueue for deep-scan jobs (Redis LPUSH when available). */
export async function enqueueDeepScanAtomic(jobId: string): Promise<void> {
  const client = redis();
  if (client) {
    await client.lpush(DEEP_SCAN_QUEUE_KEY, jobId);
    return;
  }
  await withLocalQueueLock(async () => {
    const queue = (await getPersistentRecord<string[]>(COLLECTION, LEGACY_QUEUE_KEY)) ?? [];
    if (!queue.includes(jobId)) {
      queue.unshift(jobId);
      await setPersistentRecord(COLLECTION, LEGACY_QUEUE_KEY, queue);
    }
  });
}

/**
 * Atomic dequeue — only one caller receives a given job id.
 * Redis RPOP is used in staging/production; local path is mutex-serialized.
 */
export async function dequeueDeepScanAtomic(): Promise<string | null> {
  const client = redis();
  if (client) {
    const id = await client.rpop<string>(DEEP_SCAN_QUEUE_KEY);
    return id ?? null;
  }
  return withLocalQueueLock(async () => {
    const queue = (await getPersistentRecord<string[]>(COLLECTION, LEGACY_QUEUE_KEY)) ?? [];
    const id = queue.pop() ?? null;
    await setPersistentRecord(COLLECTION, LEGACY_QUEUE_KEY, queue);
    return id;
  });
}

export async function deepScanQueueDepth(): Promise<number> {
  const client = redis();
  if (client) {
    return (await client.llen(DEEP_SCAN_QUEUE_KEY)) ?? 0;
  }
  const queue = (await getPersistentRecord<string[]>(COLLECTION, LEGACY_QUEUE_KEY)) ?? [];
  return queue.length;
}

/** Snapshot queued job IDs without mutating the queue. */
export async function listDeepScanQueueIds(): Promise<string[]> {
  const client = redis();
  if (client) {
    const ids = (await client.lrange<string>(DEEP_SCAN_QUEUE_KEY, 0, -1)) ?? [];
    return ids.filter((id): id is string => typeof id === "string" && id.length > 0);
  }
  const queue = (await getPersistentRecord<string[]>(COLLECTION, LEGACY_QUEUE_KEY)) ?? [];
  return [...queue];
}

/**
 * Rewrite the queue keeping only the provided IDs (order preserved).
 * Used to drop terminal / superseded job IDs without deleting evidence records.
 */
export async function replaceDeepScanQueueIds(keepIds: string[]): Promise<void> {
  const unique = Array.from(new Set(keepIds.filter(Boolean)));
  const client = redis();
  if (client) {
    // Atomic-ish replace: delete then re-push. Capacity may briefly read 0.
    await client.del(DEEP_SCAN_QUEUE_KEY);
    if (unique.length > 0) {
      // LPUSH preserves reverse order of args; push oldest-first so RPOP order stays FIFO.
      await client.lpush(DEEP_SCAN_QUEUE_KEY, ...[...unique].reverse());
    }
    return;
  }
  await withLocalQueueLock(async () => {
    await setPersistentRecord(COLLECTION, LEGACY_QUEUE_KEY, unique);
  });
}
