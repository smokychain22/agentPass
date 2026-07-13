#!/usr/bin/env tsx
/**
 * Recover an already-paid A2A task without requesting a second payment.
 *
 * Usage:
 *   REPODIET_PRODUCTION_URL=https://your-app.vercel.app tsx scripts/recover-a2a-paid-task.ts \
 *     --task task_aa076a3ee3534d \
 *     --quote quote_HCV6J1GH5XVg \
 *     --payment-reference 0xbc7105a03d0dfbbad1b56808887aee062189e4c0
 */
const BASE = process.env.REPODIET_PRODUCTION_URL || process.env.NEXT_PUBLIC_APP_URL || "";

function arg(name: string, fallback?: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  if (fallback) return fallback;
  throw new Error(`Missing --${name}`);
}

async function pollTask(taskId: string, until: string[], timeoutMs = 300_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`${BASE}/api/a2a/tasks/${taskId}`);
    const json = await res.json();
    if (!res.ok) throw new Error(`poll failed: ${json.error ?? res.status}`);
    if (until.includes(json.status)) return json;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`poll timeout for ${taskId}`);
}

async function main() {
  if (!BASE) {
    console.error("FAIL: Set REPODIET_PRODUCTION_URL");
    process.exit(1);
  }

  const taskId = arg("task", "task_aa076a3ee3534d");
  const quoteId = arg("quote", "quote_HCV6J1GH5XVg");
  const paymentReference = arg(
    "payment-reference",
    "0xbc7105a03d0dfbbad1b56808887aee062189e4c0"
  );

  console.log(`Recovering A2A task ${taskId}`);
  console.log(`  quote: ${quoteId}`);
  console.log(`  payment: ${paymentReference}`);

  const beforeRes = await fetch(`${BASE}/api/a2a/tasks/${taskId}`);
  const before = await beforeRes.json();
  console.log(`Previous status: ${before.status}`);

  const fundRes = await fetch(`${BASE}/api/a2a/tasks/${taskId}/fund`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quoteId, paymentReference }),
  });
  const fundJson = await fundRes.json();
  console.log(`Fund response: ${fundRes.status}`, JSON.stringify(fundJson, null, 2));

  const after =
    fundJson.status && fundRes.ok
      ? fundJson
      : await pollTask(taskId, [
          "funded",
          "queued",
          "generating_changes",
          "awaiting_approval",
          "completed",
          "payment_failed",
          "verification_failed",
        ]);

  console.log("\n--- Recovery report ---");
  console.log(`order ID: okx_order_sFkNHG30HZKM (expected)`);
  console.log(`task ID: ${taskId}`);
  console.log(`quote ID: ${quoteId}`);
  console.log(`payment reference: ${paymentReference}`);
  console.log(`previous status: ${before.status}`);
  console.log(`recovered status: ${after.status}`);
  console.log(
    `execution queued: ${["funded", "queued", "generating_changes", "verifying", "awaiting_approval", "completed"].includes(after.status)}`
  );
  console.log(`second payment requested: NO (fund body had no signature)`);
  console.log(`delivery status: ${after.pullRequest?.url ? "PR delivered" : after.status}`);

  if (after.status === "payment_failed") {
    console.error("FAIL: task still payment_failed");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
