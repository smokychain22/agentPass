#!/usr/bin/env tsx
/**
 * Controlled A2A acceptance at REPODIET_A2A_TEST_PRICE (0.20 USDT).
 *
 * Usage:
 *   REPODIET_PRODUCTION_URL=https://skillswap-virid-kappa.vercel.app \
 *   REPODIET_A2A_ACCEPTANCE_REPO=https://github.com/velz-cmd/repodiet-e2e-test \
 *   REPODIET_A2A_BUYER=0xaa895234c3fc31c40018eef975db6ac79bf87f1a \
 *   npx tsx scripts/a2a-controlled-acceptance.ts
 *
 * After PASS: remove REPODIET_A2A_TEST_PRICE, REPODIET_X402_TEST_MODE,
 * REPODIET_X402_TEST_SECRET from Vercel Production. Retain ALLOW_INTERNAL_TEST_BUYER=0.
 */
const BASE = process.env.REPODIET_PRODUCTION_URL || "https://skillswap-virid-kappa.vercel.app";
const REPO =
  process.env.REPODIET_A2A_ACCEPTANCE_REPO || "https://github.com/velz-cmd/repodiet-e2e-test";
const BUYER =
  process.env.REPODIET_A2A_BUYER || "0xaa895234c3fc31c40018eef975db6ac79bf87f1a";
const BRANCH = process.env.REPODIET_A2A_ACCEPTANCE_BRANCH || "main";

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function pollTask(taskId: string, until: string[], timeoutMs = 360_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`${BASE}/api/a2a/tasks/${taskId}`);
    const body = await json<Record<string, unknown>>(res);
    if (until.includes(String(body.status))) return body;
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw new Error(`poll timeout for ${taskId}`);
}

async function main() {
  console.log(`A2A controlled acceptance → ${BASE}`);
  console.log(`repo=${REPO} buyer=${BUYER}`);

  const submitRes = await fetch(`${BASE}/api/a2a/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-repodiet-buyer": BUYER,
    },
    body: JSON.stringify({
      type: "repository.cleanup_pr",
      repoUrl: REPO,
      branch: BRANCH,
      payer: BUYER,
    }),
  });
  const submitted = await json<Record<string, unknown>>(submitRes);
  const taskId = String(submitted.taskId || "");
  if (!taskId) throw new Error(`submit failed: ${JSON.stringify(submitted)}`);
  console.log(`task=${taskId} status=${submitted.status}`);

  let task = submitted;
  if (task.status === "awaiting_payment" || task.status === "quote_required") {
    const receipt = task.receipt as { quote?: Record<string, unknown> } | undefined;
    const quote =
      receipt?.quote ||
      (
        await json<{ quote?: Record<string, unknown> }>(
          await fetch(`${BASE}/api/a2a/tasks/${taskId}`)
        )
      ).quote;
    const quoteId = String(
      (quote as { quoteId?: string } | undefined)?.quoteId ||
        String(task.limitations || "")
          .match(/Quote (quote_[A-Za-z0-9_-]+)/)?.[1] ||
        ""
    );
    if (!quoteId) throw new Error("awaiting_payment without quoteId");
    const amountMicro = String((quote as { amountMicro?: string } | undefined)?.amountMicro || "");
    if (amountMicro && amountMicro !== "200000") {
      throw new Error(`expected test price 200000 micro, got ${amountMicro}`);
    }
    const paymentReference = `0xtest_a2a_accept_${Date.now().toString(16)}`;
    const payRes = await fetch(`${BASE}/api/tasks/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteId,
        paymentReference,
        payer: BUYER,
        idempotencyKey: `pay_${quoteId}`,
      }),
    });
    const payBody = await json<Record<string, unknown>>(payRes);
    if (!payBody.success) throw new Error(`pay failed: ${JSON.stringify(payBody)}`);
    console.log(`paid quote=${quoteId} amountMicro=${amountMicro || "200000"}`);

    const fundRes = await fetch(`${BASE}/api/a2a/tasks/${taskId}/fund`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quoteId, paymentReference, payer: BUYER }),
    });
    task = await json<Record<string, unknown>>(fundRes);
    console.log(`funded status=${task.status}`);
  }

  if (task.status !== "awaiting_approval") {
    task = await pollTask(taskId, [
      "awaiting_approval",
      "verification_failed",
      "analysis_failed",
      "payment_failed",
      "delivery_failed",
    ]);
  }
  if (task.status !== "awaiting_approval") {
    throw new Error(`expected awaiting_approval, got ${task.status}: ${task.error}`);
  }

  const approveRes = await fetch(`${BASE}/api/a2a/tasks/${taskId}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approved: true }),
  });
  task = await json<Record<string, unknown>>(approveRes);
  console.log(`approve status=${task.status} error=${task.error || ""}`);

  if (
    ![
      "delivery_ready",
      "delivery_submitted",
      "monitoring_checks",
      "creating_pull_request",
    ].includes(String(task.status))
  ) {
    task = await pollTask(taskId, [
      "delivery_ready",
      "delivery_submitted",
      "delivery_failed",
      "checks_failed",
    ]);
  }

  const pr =
    (task.pullRequest as { url?: string } | undefined)?.url ||
    (task.prDelivery as { url?: string } | undefined)?.url;
  if (!pr && task.status === "delivery_failed") {
    throw new Error(`Green PR failed: ${task.error}`);
  }
  console.log(`greenPr=${pr || "(pending)"} status=${task.status}`);

  if (task.status === "delivery_ready") {
    const deliveryRes = await fetch(`${BASE}/api/okx/a2a/tasks/${taskId}/delivery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    task = await json<Record<string, unknown>>(deliveryRes);
  }

  const acceptRes = await fetch(`${BASE}/api/okx/a2a/tasks/${taskId}/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ buyer: BUYER }),
  });
  task = await json<Record<string, unknown>>(acceptRes);
  console.log(`buyer_accept status=${task.status}`);

  const releaseRef = `okx_escrow_release_test_${Date.now().toString(16)}`;
  const releaseRes = await fetch(`${BASE}/api/okx/a2a/tasks/${taskId}/release`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ escrowReleaseReference: releaseRef }),
  });
  task = await json<Record<string, unknown>>(releaseRes);
  console.log(`release status=${task.status} ref=${releaseRef}`);

  if (task.status !== "completed" && task.status !== "escrow_released") {
    throw new Error(`expected completed/escrow_released, got ${task.status}`);
  }

  console.log("A2A_CONTROLLED_ACCEPTANCE_PASS");
  console.log(
    "NEXT: Remove REPODIET_A2A_TEST_PRICE, REPODIET_X402_TEST_MODE, REPODIET_X402_TEST_SECRET; retain ALLOW_INTERNAL_TEST_BUYER=0"
  );
}

main().catch((err) => {
  console.error("A2A_CONTROLLED_ACCEPTANCE_FAIL", err);
  process.exit(1);
});
