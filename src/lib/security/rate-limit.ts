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
  verify: 5,
  download: 30,
  tools: 60,
};

export class RateLimitError extends Error {
  retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("Rate limit exceeded. Try again later.");
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function bucketKey(ownerKey: string, action: string): string {
  return `${ownerKey}:${action}`;
}

export async function enforceRateLimit(
  ownerKey: string,
  action: string,
  limit?: number
): Promise<void> {
  const max = limit ?? DEFAULT_LIMITS[action] ?? 30;
  const now = Date.now();
  const key = bucketKey(ownerKey, action);

  await withDurableDb((db) => {
    const usage = (db.usage[key] as UsageBucket | undefined) ?? {
      count: 0,
      windowStart: new Date(now).toISOString(),
    };

    const windowStart = Date.parse(usage.windowStart);
    if (Number.isNaN(windowStart) || now - windowStart > WINDOW_MS) {
      usage.count = 0;
      usage.windowStart = new Date(now).toISOString();
    }

    if (usage.count >= max) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((windowStart + WINDOW_MS - now) / 1000)
      );
      throw new RateLimitError(retryAfterSeconds);
    }

    usage.count += 1;
    db.usage[key] = usage;
  });
}
