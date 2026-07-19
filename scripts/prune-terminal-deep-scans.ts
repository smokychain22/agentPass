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
 * Never deletes receipts, attestations, payment records, or funded A2A tasks.
 * Only removes deep_scan_jobs / queue index entries older than REPODIET_PRUNE_AGE_HOURS
 * that are in terminal stages (READY/COMPLETED/FAILED_*).
 */
import { Redis } from "@upstash/redis";

const APPLY = process.argv.includes("--apply");
const AGE_HOURS = Number(process.env.REPODIET_PRUNE_AGE_HOURS || "24");
const MAX_DELETE = Number(process.env.REPODIET_PRUNE_MAX || "200");

const TERMINAL = new Set([
  "READY",
  "COMPLETED",
  "FAILED_TERMINAL",
  "FAILED_RETRYABLE",
  "SUPERSEDED",
  "CANCELLED",
]);

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
  const keys = (await redis.keys("deep_scan_jobs:*")) as string[];
  const candidates: Array<{ key: string; id: string; stage: string; updatedAt: string }> = [];

  for (const key of keys) {
    if (candidates.length >= MAX_DELETE) break;
    const raw = await redis.get(key);
    if (!raw || typeof raw !== "object") continue;
    const job = raw as { id?: string; stage?: string; updatedAt?: string; createdAt?: string };
    const stage = String(job.stage || "");
    if (!TERMINAL.has(stage)) continue;
    const ts = Date.parse(job.updatedAt || job.createdAt || "");
    if (!Number.isFinite(ts) || ts > cutoff) continue;
    candidates.push({
      key,
      id: String(job.id || key.replace(/^deep_scan_jobs:/, "")),
      stage,
      updatedAt: String(job.updatedAt || job.createdAt || ""),
    });
  }

  const report = {
    mode: APPLY ? "apply" : "dry_run",
    ageHours: AGE_HOURS,
    scannedKeys: keys.length,
    pruneCandidates: candidates.length,
    candidates: candidates.slice(0, 50),
    deleted: 0 as number,
  };

  if (APPLY) {
    for (const c of candidates) {
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
