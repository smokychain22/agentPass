import { withDurableDb } from "@/lib/store/durable-store";

interface UsageBucket {
  count: number;
  windowStart: string;
}

const WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_LIMITS: Record<string, number> = {
  scan: 20,
  findings: 10,
  patch: 10,
  "patch:free": 10,
  "patch:paid": 20,
  verify: 5,
  download: 30,
  tools: 60,
};

export interface RateLimitSnapshot {
  code: "rate_limit_exceeded";
  retryAfterSeconds: number;
  limit: number;
  remaining: number;
  resetAt: string;
}

export class RateLimitError extends Error {
  retryAfterSeconds: number;
  limit: number;
  remaining: number;
  resetAt: string;

  constructor(snapshot: RateLimitSnapshot) {
    super(`Rate limit exceeded. Retry after ${snapshot.retryAfterSeconds}s.`);
    this.name = "RateLimitError";
    this.retryAfterSeconds = snapshot.retryAfterSeconds;
    this.limit = snapshot.limit;
    this.remaining = snapshot.remaining;
    this.resetAt = snapshot.resetAt;
  }

  toJSON(): RateLimitSnapshot {
    return {
      code: "rate_limit_exceeded",
      retryAfterSeconds: this.retryAfterSeconds,
      limit: this.limit,
      remaining: this.remaining,
      resetAt: this.resetAt,
    };
  }
}

function bucketKey(ownerKey: string, action: string, scopeKey?: string): string {
  return scopeKey ? `${ownerKey}:${action}:${scopeKey}` : `${ownerKey}:${action}`;
}

export async function enforceRateLimit(
  ownerKey: string,
  action: string,
  options?: { limit?: number; scopeKey?: string; consume?: boolean }
): Promise<{ limit: number; remaining: number; resetAt: string }> {
  const consume = options?.consume !== false;
  const max = options?.limit ?? DEFAULT_LIMITS[action] ?? 30;
  const now = Date.now();
  const key = bucketKey(ownerKey, action, options?.scopeKey);

  return withDurableDb((db) => {
    const usage = (db.usage[key] as UsageBucket | undefined) ?? {
      count: 0,
      windowStart: new Date(now).toISOString(),
    };

    let windowStart = Date.parse(usage.windowStart);
    if (Number.isNaN(windowStart) || now - windowStart > WINDOW_MS) {
      usage.count = 0;
      usage.windowStart = new Date(now).toISOString();
      windowStart = now;
    }

    const resetAt = new Date(windowStart + WINDOW_MS).toISOString();
    const remaining = Math.max(0, max - usage.count);

    if (usage.count >= max) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((windowStart + WINDOW_MS - now) / 1000)
      );
      throw new RateLimitError({
        code: "rate_limit_exceeded",
        retryAfterSeconds,
        limit: max,
        remaining: 0,
        resetAt,
      });
    }

    if (consume) {
      usage.count += 1;
      db.usage[key] = usage;
    }

    return {
      limit: max,
      remaining: Math.max(0, max - usage.count),
      resetAt,
    };
  });
}

export async function getRateLimitStatus(
  ownerKey: string,
  action: string,
  options?: { limit?: number; scopeKey?: string }
): Promise<{ limit: number; remaining: number; resetAt: string }> {
  return enforceRateLimit(ownerKey, action, { ...options, consume: false });
}
