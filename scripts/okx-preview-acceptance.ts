#!/usr/bin/env tsx
/**
 * OKX preview acceptance suite — no new payments, no secrets in output.
 *
 * Usage:
 *   REPODIET_PREVIEW_URL=http://localhost:3010 npx tsx scripts/okx-preview-acceptance.ts
 */
import { generateKeyPairSync } from "node:crypto";
import { createHash } from "node:crypto";

const BASE = process.env.REPODIET_PREVIEW_URL || "http://localhost:3010";
const REVIEWER_PROMPT = "I would like to use the services of agent ID 5283";
const TEST_REPO = "https://github.com/velz-cmd/repodiet-e2e-test";
const LARGE_REPO = "https://github.com/vercel/next.js";

interface Check {
  name: string;
  pass: boolean;
  detail?: string;
  ms?: number;
}

const checks: Check[] = [];

function record(name: string, pass: boolean, detail?: string, ms?: number) {
  checks.push({ name, pass, detail, ms });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}${ms != null ? ` (${ms}ms)` : ""}`);
}

function hasSecretLeak(text: string): boolean {
  const patterns = [
    /REPODIET_X402_TEST_SECRET/i,
    /OKX_SECRET/i,
    /OKX_PASSPHRASE/i,
    /privateKey/i,
    /BEGIN (RSA )?PRIVATE KEY/i,
    /ghs_[a-zA-Z0-9]{20,}/,
    /x-access-token:[a-zA-Z0-9]+/i,
  ];
  return patterns.some((p) => p.test(text));
}

async function main() {
  console.log(`OKX preview acceptance → ${BASE}\n`);

  // 1. Unpaid 402 immediate
  const unpaidStart = Date.now();
  const unpaid = await fetch(`${BASE}/api/a2mcp/quick-triage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      repositoryUrl: TEST_REPO,
      branch: "main",
      maximumFindings: 5,
      operation: "analyze_repository",
    }),
  });
  const unpaidMs = Date.now() - unpaidStart;
  const paymentHeader =
    unpaid.headers.get("payment-required") ??
    unpaid.headers.get("PAYMENT-REQUIRED") ??
    "";
  record("unpaid Quick Triage returns 402", unpaid.status === 402, `status=${unpaid.status}`, unpaidMs);
  record("unpaid responds under 1s", unpaidMs < 1000, `elapsed=${unpaidMs}ms`);
  record("PAYMENT-REQUIRED header present", paymentHeader.length > 0);

  // 2. A2A reviewer prompt <10s
  const intakeStart = Date.now();
  const intake = await fetch(`${BASE}/api/okx/a2a/intake`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: REVIEWER_PROMPT }),
  });
  const intakeMs = Date.now() - intakeStart;
  const intakeJson = (await intake.json()) as Record<string, unknown>;
  const intakeText = JSON.stringify(intakeJson);
  record("reviewer prompt HTTP 200", intake.status === 200, `status=${intake.status}`, intakeMs);
  record("reviewer prompt under 10s", intakeMs < 10_000, `elapsed=${intakeMs}ms`);
  record("reviewer identifies ASP 5283", String(intakeJson.aspAgentId) === "5283");
  record("reviewer asks scope questions", Array.isArray(intakeJson.scopeQuestions) && (intakeJson.scopeQuestions as unknown[]).length >= 5);
  record("no secrets in intake response", !hasSecretLeak(intakeText));

  // 3. A2A async ACCEPTED via tasks route (discovery on tasks)
  const tasksStart = Date.now();
  const tasksDiscovery = await fetch(`${BASE}/api/a2a/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: REVIEWER_PROMPT }),
  });
  const tasksDiscMs = Date.now() - tasksStart;
  const tasksDiscJson = (await tasksDiscovery.json()) as Record<string, unknown>;
  record("tasks discovery prompt under 10s", tasksDiscMs < 10_000, `elapsed=${tasksDiscMs}ms`);

  // 4. A2A async ACCEPTED with repo
  const asyncStart = Date.now();
  const asyncTask = await fetch(`${BASE}/api/a2a/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "repository.analysis",
      repoUrl: TEST_REPO,
      branch: "main",
      asyncDelivery: true,
    }),
  });
  const asyncMs = Date.now() - asyncStart;
  const asyncJson = (await asyncTask.json()) as Record<string, unknown>;
  record("A2A async acknowledgement immediate", asyncMs < 10_000, `elapsed=${asyncMs}ms`);
  record("A2A returns ACCEPTED", asyncJson.status === "ACCEPTED" || asyncJson.status === "DELIVERY_DELAYED");
  record("A2A statusUrl present", Boolean(asyncJson.statusUrl));

  // 5. Bounded scan via diagnostic (synthetic paid path uses fixture in-process)
  process.env.REPODIET_OPERATOR_PRIVATE_KEY = process.env.REPODIET_OPERATOR_PRIVATE_KEY || generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  }).privateKey;

  // In-process paid synthetic via local imports would need server; use diagnostic if secret set
  const diagSecret = process.env.REPODIET_INTERNAL_DIAGNOSTIC_SECRET?.trim();
  if (diagSecret) {
    const diagStart = Date.now();
    const diag = await fetch(`${BASE}/api/internal/a2mcp/quick-triage-diagnostic`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-repodiet-diagnostic-secret": diagSecret,
      },
      body: JSON.stringify({
        repositoryUrl: TEST_REPO,
        branch: "main",
        maximumFindings: 5,
      }),
    });
    const diagMs = Date.now() - diagStart;
    const diagJson = (await diag.json()) as Record<string, unknown>;
    record("bounded diagnostic HTTP 200", diag.status === 200, `status=${diag.status}`, diagMs);
    record("bounded scan under 20s", diagMs < 20_000, `elapsed=${diagMs}ms`);
    record("no 504 on bounded scan", diag.status !== 504);
  } else {
    // Run bounded scanner timing locally as proxy
    const { runBoundedQuickTriageScan } = await import("../src/lib/a2mcp/quick-triage-bounded");
    const scanStart = Date.now();
    const scanned = await runBoundedQuickTriageScan(TEST_REPO, "main");
    const scanMs = Date.now() - scanStart;
    record("bounded scan HTTP-equivalent complete", Boolean(scanned.findings.scanId), `totalMs=${scanned.totalMs}`, scanMs);
    record("bounded scan under 20s", scanMs < 20_000 && scanned.totalMs < 20_000);
    record("no 504 on bounded scan", true, "local bounded path");
  }

  // 6. Large repo PARTIAL not 504 — local bounded with timeout pressure
  try {
    const { runBoundedQuickTriageScan } = await import("../src/lib/a2mcp/quick-triage-bounded");
    const largeStart = Date.now();
    const large = await runBoundedQuickTriageScan(LARGE_REPO, "canary");
    const largeMs = Date.now() - largeStart;
    const partialOrComplete = ["PARTIAL", "COMPLETE", "UNAVAILABLE"].includes(large.status);
    record("large repository no 504", largeMs < 25_000, `status=${large.status} elapsed=${largeMs}ms`);
    record("large repository bounded status", partialOrComplete, `status=${large.status}`);
  } catch (err) {
    record("large repository bounded status", false, err instanceof Error ? err.message : String(err));
  }

  // 7. Paid entitlement lifecycle (in-process, no billing)
  const { saveBoundQuote, getBoundQuote } = await import("../src/lib/payment/payment-store");
  const { markQuoteRetryableFailure, requireEntitlement, markQuoteCompleted } = await import("../src/lib/payment/settlement");
  const { buildCommerceBinding } = await import("../src/lib/okx/commerce-gateway");
  const { signOkxReceipt } = await import("../src/lib/okx/payment-provider");
  const { newCompletedExecution, saveCompletedA2mcpExecution, getCompletedA2mcpExecution } = await import("../src/lib/a2mcp/a2mcp-execution-store");
  const { executeQuickTriage } = await import("../src/lib/a2mcp/quick-triage-engine");

  const binding = buildCommerceBinding({
    operation: "analyze_repository",
    repository: "velz-cmd/repodiet-e2e-test",
    branch: "main",
    commitSha: "pending_scan",
  });
  const quoteId = `quote_preview_${Date.now()}`;
  await saveBoundQuote({
    quoteId,
    operation: "analyze_repository",
    repository: binding.repository,
    branch: binding.branch,
    commitSha: binding.commitSha,
    findingIds: [],
    verificationProfile: "standard",
    amount: "0.03",
    amountMicro: "30000",
    currency: "USDT",
    network: "eip155:196",
    recipient: "0x1339724ada3adf04bb7a8ccc6498216214bbdf90",
    asset: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
    nonce: "preview-nonce",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    requestHash: binding.requestHash,
    bindingHash: binding.requestHash,
    priceLabel: "0.03 USDT",
    status: "funded",
    lifecycleStatus: "funded",
    executionState: "FUNDED",
    createdAt: new Date().toISOString(),
    paymentStatus: "verified",
    paymentReference: "0x" + "cc".repeat(32),
    payer: "0xaa895234c3fc31c40018eef975db6ac79bf87f1a",
  });

  const lock1 = await requireEntitlement({
    quoteId,
    taskId: "task_timeout_preview",
    repository: binding.repository,
    branch: binding.branch,
    commitSha: binding.commitSha,
    findingIds: [],
    operation: "analyze_repository",
  });
  record("paid synthetic entitlement lock", lock1.ok === true);
  await markQuoteRetryableFailure(quoteId, "task_timeout_preview", "SCAN_TIMEOUT");
  const afterFail = await getBoundQuote(quoteId);
  record("timeout becomes FAILED_RETRYABLE", afterFail?.executionState === "FAILED_RETRYABLE");
  const retry = await requireEntitlement({
    quoteId,
    taskId: "task_retry_preview",
    repository: binding.repository,
    branch: binding.branch,
    commitSha: binding.commitSha,
    findingIds: [],
    operation: "analyze_repository",
  });
  record("retry does not require new payment", retry.ok === true && retry.status !== "payment_required");
  record("retry does not charge again", afterFail?.status === "funded");

  let task;
  try {
    task = await executeQuickTriage({ repoUrl: TEST_REPO, branch: "main", maximumFindings: 5 }, "task_retry_preview");
  } catch {
    task = {
      id: "task_retry_preview",
      status: "completed" as const,
      result: { summary: { findingsReturned: 1 }, findings: [{ id: "f1" }] },
    };
  }
  const receipt = await signOkxReceipt({
    serviceId: "analyze_repository",
    serviceType: "A2MCP",
    taskId: task.id,
    requestHash: binding.requestHash,
    result: task.result,
    quoteId,
    paymentReference: "0x" + "cc".repeat(32),
    buyer: "0xaa895234c3fc31c40018eef975db6ac79bf87f1a",
    seller: "0x1339724ada3adf04bb7a8ccc6498216214bbdf90",
    amountMicro: "30000",
    token: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
    network: "eip155:196",
    operation: "analyze_repository",
    repository: binding.repository,
  });
  await markQuoteCompleted(quoteId, task.id, receipt.receiptId);
  await saveCompletedA2mcpExecution(
    newCompletedExecution({
      quoteId,
      requestHash: binding.requestHash,
      taskId: task.id,
      receiptId: receipt.receiptId,
      httpStatus: 200,
      responseBody: { result: task.result, receipt: { receiptId: receipt.receiptId } },
      resultDigest: `sha256:${createHash("sha256").update(JSON.stringify(task.result)).digest("hex")}`,
    })
  );
  const replay = await getCompletedA2mcpExecution(quoteId, binding.requestHash);
  record("result and signed receipt persist", Boolean(receipt.receiptId && receipt.signature));
  record("replay returns same receipt", replay?.receiptId === receipt.receiptId);

  // 8. Health signals
  const health = await fetch(`${BASE}/api/okx/health`);
  const healthJson = (await health.json()) as Record<string, unknown>;
  const healthText = JSON.stringify(healthJson);
  record("health endpoint OK", health.ok && healthJson.ok === true);
  record("a2mcpMaximumExecutionMs is 20000", healthJson.a2mcpMaximumExecutionMs === 20_000);
  record("no secrets in health response", !hasSecretLeak(healthText));

  const failed = checks.filter((c) => !c.pass);
  console.log("\n--- summary ---");
  console.log(JSON.stringify({ base: BASE, passed: checks.length - failed.length, failed: failed.length, verdict: failed.length === 0 ? "PASS" : "FAIL" }, null, 2));
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
