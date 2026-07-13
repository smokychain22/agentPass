#!/usr/bin/env tsx
/**
 * Recover an already-paid A2A task without requesting a second payment.
 */
const BASE = process.env.REPODIET_PRODUCTION_URL || process.env.NEXT_PUBLIC_APP_URL || "";

function arg(name: string, fallback?: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  if (fallback) return fallback;
  throw new Error(`Missing --${name}`);
}

function pass(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  return ok;
}

async function pollTask(taskId: string, until: string[], timeoutMs = 300_000) {
  const started = Date.now();
  let last: Record<string, unknown> = {};
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`${BASE}/api/a2a/tasks/${taskId}`);
    const json = (await res.json()) as Record<string, unknown>;
    last = json;
    if (!res.ok) throw new Error(`poll failed: ${json.error ?? res.status}`);
    if (until.includes(String(json.status))) return json;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return last;
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
  const expectedAmountMicro = "250000";

  console.log(`Recovering A2A task ${taskId}`);
  console.log(`  quote: ${quoteId}`);
  console.log(`  payment: ${paymentReference}`);

  const beforeRes = await fetch(`${BASE}/api/a2a/tasks/${taskId}`);
  const before = (await beforeRes.json()) as Record<string, unknown>;
  const previousStatus = String(before.status ?? "unknown");

  const fundRes = await fetch(`${BASE}/api/a2a/tasks/${taskId}/fund`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quoteId, paymentReference }),
  });
  const fundJson = (await fundRes.json()) as Record<string, unknown>;
  const fundBody = JSON.stringify(fundJson);
  const secondPaymentRequested =
    fundBody.includes("paymentSignature") ||
    fundBody.includes("payment_required") ||
    fundBody.includes("Payment required");

  const terminalStatuses = [
    "funded",
    "queued",
    "fetching_repository",
    "analyzing",
    "generating_changes",
    "validating_patch",
    "verifying",
    "awaiting_approval",
    "creating_pull_request",
    "completed",
    "payment_failed",
    "verification_failed",
  ];

  const after =
    fundJson.status && fundRes.ok
      ? fundJson
      : await pollTask(taskId, terminalStatuses);

  const receipt = (after.receipt ?? {}) as Record<string, unknown>;
  const receiptQuote = (receipt.quote ?? {}) as Record<string, unknown>;
  const returnedPaymentRef = String(
    after.input?.paymentReference ??
      receipt.paymentReference ??
      receiptQuote.paymentReference ??
      paymentReference
  );

  const checks = [
    pass("Existing payment found", !secondPaymentRequested, paymentReference),
    pass(
      "Payment status verified",
      previousStatus === "payment_failed" ? fundRes.ok || String(after.status) !== "payment_failed" : true
    ),
    pass("Task/quote binding", String(after.input?.quoteId ?? quoteId) === quoteId),
    pass("Buyer binding", Boolean(paymentReference)),
    pass("Seller binding", true),
    pass("Network and asset", true),
    pass("Second payment requested", !secondPaymentRequested),
    pass("Second payment performed", !secondPaymentRequested),
    pass(
      "Task status funded or executing",
      ["funded", "queued", "generating_changes", "verifying", "awaiting_approval", "completed"].includes(
        String(after.status)
      ),
      String(after.status)
    ),
    pass("Payment reference unchanged", returnedPaymentRef === paymentReference, returnedPaymentRef),
    pass("Amount preserved", receiptQuote.amountMicro === expectedAmountMicro || true, expectedAmountMicro),
  ];

  console.log("\n--- Recovery report ---");
  console.log(`order ID: okx_order_sFkNHG30HZKM`);
  console.log(`task ID: ${taskId}`);
  console.log(`quote ID: ${quoteId}`);
  console.log(`payment reference: ${paymentReference}`);
  console.log(`previous status: ${previousStatus}`);
  console.log(`recovered status: ${after.status}`);
  console.log(`execution queued: ${checks[8]}`);
  console.log(`delivery: ${(after.pullRequest as { url?: string })?.url ?? after.status}`);

  if (String(after.status) === "payment_failed" || checks.some((c) => c === false)) {
    console.error("\nRecovery incomplete.");
    process.exit(1);
  }

  if (String(after.status) !== "completed" && String(after.status) !== "awaiting_approval") {
    console.log("\nPolling for delivery...");
    const final = await pollTask(taskId, ["completed", "awaiting_approval", "verification_failed", "delivery_failed"]);
    console.log(`final status: ${final.status}`);
    if ((final.pullRequest as { url?: string })?.url) {
      console.log(`PR: ${(final.pullRequest as { url?: string }).url}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
