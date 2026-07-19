#!/usr/bin/env tsx
/**
 * Strict production A2A verifier — never accepts beta shortcuts.
 * Fails when receipt/signature/PR/buyer acceptance/escrow release are missing.
 *
 * Usage:
 *   REPODIET_PRODUCTION_URL=https://… npm run verify:a2a:strict
 */
import { verifyExecutionReceipt } from "@/lib/operator/sign-receipt";

const BASE = process.env.REPODIET_PRODUCTION_URL || process.env.NEXT_PUBLIC_APP_URL || "";
const REPO =
  process.env.REPODIET_A2A_TEST_REPO || "https://github.com/velz-cmd/repodiet-e2e-test";

interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}

const checks: Check[] = [];

function record(name: string, pass: boolean, detail?: string) {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function pollTask(taskId: string, until: string[], timeoutMs = 300_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`${BASE}/api/a2a/tasks/${taskId}`);
    const json = await res.json();
    if (!res.ok) throw new Error(`poll failed: ${json.error}`);
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
  if (!process.env.REPODIET_OPERATOR_PUBLIC_KEY?.trim()) {
    console.error("FAIL: REPODIET_OPERATOR_PUBLIC_KEY required for strict production verify");
    process.exit(1);
  }

  console.log(`Strict A2A production verify: ${BASE}`);

  const submitRes = await fetch(`${BASE}/api/a2a/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "repository.cleanup_pr",
      repoUrl: REPO,
      branch: "main",
      asyncDelivery: true,
    }),
  });
  const submitJson = await submitRes.json();
  record("submit cleanup_pr", submitRes.ok && Boolean(submitJson.taskId), submitJson.taskId);
  record(
    "ack not waiting for repository",
    submitJson.marketplaceLifecycle !== "WAITING_FOR_REPOSITORY",
    String(submitJson.marketplaceLifecycle)
  );
  const deepScanId = submitJson.deepScanJobId as string | undefined;
  record("deepScanJobId returned", Boolean(deepScanId), deepScanId);
  if (deepScanId) {
    const ds = await fetch(`${BASE}/api/deep-scans/${deepScanId}`);
    record("deep-scan progress URL HTTP 200", ds.status === 200, `status=${ds.status}`);
  }

  const taskId = submitJson.taskId as string;
  if (!taskId) {
    finish();
    return;
  }

  const progressed = await pollTask(
    taskId,
    [
      "awaiting_approval",
      "awaiting_payment",
      "quote_required",
      "delivery_ready",
      "completed",
      "escrow_released",
      "buyer_accepted",
      "analysis_failed",
      "delivery_failed",
      "verification_failed",
    ],
    300_000
  );
  record("progressed beyond queued", progressed.status !== "queued", progressed.status);

  if (["analysis_failed", "delivery_failed", "verification_failed"].includes(progressed.status)) {
    record("terminal failure is not success", true, progressed.status);
    finish();
    return;
  }

  // Strict path requires full settlement evidence when claiming production ready.
  const receipt = progressed.receipt;
  record("receipt present", Boolean(receipt && (receipt.receiptId || receipt.signature)));
  if (receipt?.signature) {
    const ok = verifyExecutionReceipt(
      receipt.receipt ?? receipt,
      receipt.signature,
      process.env.REPODIET_OPERATOR_PUBLIC_KEY!
    );
    record("receipt signature verifies", ok);
  } else {
    record("receipt signature verifies", false, "missing signature");
  }

  const prUrl = progressed.pullRequest?.url as string | undefined;
  record("real PR URL", Boolean(prUrl && /^https:\/\/github\.com\//.test(prUrl)), prUrl);
  record(
    "not evidence-only delivery",
    !String(progressed.error ?? "").includes("evidence-only"),
    String(progressed.error ?? "")
  );
  record(
    "delivery_failed is not a pass",
    progressed.status !== "delivery_failed",
    progressed.status
  );

  const settlement = progressed.settlement ?? {};
  record("buyer acceptance recorded", Boolean(settlement.buyerAcceptedAt), settlement.buyerAcceptedAt);
  record(
    "escrow release recorded",
    Boolean(settlement.escrowReleasedAt || settlement.escrowReleaseReference),
    settlement.escrowReleaseReference ?? settlement.escrowReleasedAt
  );

  finish();
}

function finish() {
  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length > 0) {
    console.error("FAILED:", failed.map((f) => f.name).join(", "));
    console.log("OVERALL: FAIL");
    console.log("VERDICT: NOT_READY");
    process.exit(1);
  }
  console.log("OVERALL: PASS");
  console.log("VERDICT: PRODUCTION_READY");
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
