#!/usr/bin/env npx tsx
/**
 * Owner-assisted Upstash capacity reclaim for terminal deep-scan jobs.
 *
 * Requires:
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 *
 * Dry-run by default. Apply with: --apply
 *
 * Uses cursor SCAN on `repodiet:deep_scan_jobs:*` (never blocking KEYS).
 * Never deletes payments, entitlements, contracts, receipts, attestations,
 * funded tasks, buyer acceptance, or settlement evidence.
 */
import { Redis } from "@upstash/redis";

const APPLY = process.argv.includes("--apply");
const AGE_HOURS = Number(process.env.REPODIET_PRUNE_AGE_HOURS || "24");
const MAX_DELETE = Number(process.env.REPODIET_PRUNE_MAX || "200");

const JOB_PREFIX = "repodiet:deep_scan_jobs:";

const TERMINAL = new Set([
  "READY",
  "COMPLETED",
  "FAILED_TERMINAL",
  "FAILED_RETRYABLE",
  "SUPERSEDED",
  "CANCELLED",
]);

const PROTECTED_PREFIXES = [
  "repodiet:payments:",
  "repodiet:payment_entitlements:",
  "repodiet:execution_receipts:",
  "repodiet:green_pr_receipts:",
  "repodiet:green_pr_attestations:",
  "repodiet:maintenance_contracts:",
  "repodiet:okx_orders:",
  "repodiet:marketplace_deliveries:",
];

function isProtectedKey(key: string): boolean {
  return PROTECTED_PREFIXES.some((p) => key.startsWith(p));
}

async function scanKeys(redis: Redis, match: string, count = 100): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | number = 0;
  do {
    const [next, keys] = (await redis.scan(cursor, { match, count })) as [
      string | number,
      string[],
    ];
    cursor = next;
    out.push(...keys);
    if (out.length >= MAX_DELETE * 5) break;
  } while (String(cursor) !== "0");
  return out;
}

async function main() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) {
    console.error(
      JSON.stringify(
        {
          code: "OWNER_ACTION_REQUIRED",
          error:
            "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required. Export them from the Vercel skillswap project (never commit).",
        },
        null,
        2
      )
    );
    process.exit(2);
  }

  const redis = new Redis({ url, token });
  const cutoff = Date.now() - AGE_HOURS * 3600_000;
  const keys = await scanKeys(redis, `${JOB_PREFIX}*`);
  const candidates: Array<{ key: string; id: string; stage: string; updatedAt: string }> = [];

  for (const key of keys) {
    if (candidates.length >= MAX_DELETE) break;
    if (isProtectedKey(key)) continue;
    if (!key.startsWith(JOB_PREFIX)) continue;
    const raw = await redis.get(key);
    if (!raw || typeof raw !== "object") continue;
    const job = raw as {
      id?: string;
      stage?: string;
      updatedAt?: string;
      createdAt?: string;
      claimedBy?: string;
      leaseExpiresAt?: string;
      workflowRunId?: string;
    };
    const stage = String(job.stage || "");
    if (!TERMINAL.has(stage)) continue;
    // Never prune active/leased work even if stage string is wrong.
    if (job.claimedBy && job.leaseExpiresAt && Date.parse(job.leaseExpiresAt) > Date.now()) {
      continue;
    }
    const ts = Date.parse(job.updatedAt || job.createdAt || "");
    if (!Number.isFinite(ts) || ts > cutoff) continue;
    candidates.push({
      key,
      id: String(job.id || key.slice(JOB_PREFIX.length)),
      stage,
      updatedAt: String(job.updatedAt || job.createdAt || ""),
    });
  }

  const report = {
    mode: APPLY ? "apply" : "dry_run",
    keyPrefix: JOB_PREFIX,
    ageHours: AGE_HOURS,
    scannedKeys: keys.length,
    pruneCandidates: candidates.length,
    candidates: candidates.slice(0, 50),
    deleted: 0 as number,
    protectedPrefixes: PROTECTED_PREFIXES,
  };

  if (APPLY) {
    for (const c of candidates) {
      if (isProtectedKey(c.key)) continue;
      await redis.del(c.key);
      report.deleted += 1;
    }
  }

  console.log(JSON.stringify(report, null, 2));
  if (!APPLY) {
    console.error("Dry-run only. Re-run with --apply after reviewing candidates.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
