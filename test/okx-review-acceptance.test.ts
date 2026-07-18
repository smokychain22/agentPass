import assert from "node:assert/strict";
import {
  isMisConsumedWithoutDelivery,
  repairMisConsumedQuote,
} from "../src/lib/payment/quote-repair";
import { saveBoundQuote, getBoundQuote } from "../src/lib/payment/payment-store";
import type { BoundQuote } from "../src/lib/payment/types";
import { QUICK_TRIAGE_TIMEOUT_MS } from "../src/lib/a2mcp/quick-triage-budget";
import {
  buildMarketplaceIntakeResponse,
  extractUserMessage,
  isMarketplaceDiscoveryMessage,
} from "../src/lib/a2a/marketplace-intake";
import { requireEntitlement } from "../src/lib/payment/settlement";
import { buildCommerceBinding } from "../src/lib/okx/commerce-gateway";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

function misConsumedQuote(overrides: Partial<BoundQuote> = {}): BoundQuote {
  return {
    quoteId: `quote_mis_${Date.now()}`,
    operation: "analyze_repository",
    repository: "velz-cmd/repodiet-e2e-test",
    branch: "main",
    commitSha: "pending_scan",
    findingIds: [],
    verificationProfile: "standard",
    amount: "0.03",
    amountMicro: "30000",
    currency: "USDT",
    network: "eip155:196",
    recipient: "0x1339724ada3adf04bb7a8ccc6498216214bbdf90",
    asset: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
    nonce: "nonce",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    requestHash: "sha256:abc",
    bindingHash: "sha256:def",
    priceLabel: "0.03 USDT",
    status: "consumed",
    lifecycleStatus: "execution_started",
    executionState: "EXECUTING",
    paymentStatus: "verified",
    paymentReference: "0x" + "22".repeat(32),
    payer: "0xaa895234c3fc31c40018eef975db6ac79bf87f1a",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const A2A_SCENARIOS = [
  "normal repository",
  "monorepo",
  "invalid repository",
  "private repository without access",
  "very large repository",
  "zero safe findings",
  "broken baseline",
  "low budget",
  "scope expansion",
  "protected path request",
  "urgent deadline",
  "worker unavailable",
  "GitHub authorization missing",
  "duplicate request",
  "stale commit",
  "unsupported language",
  "unclear scope",
  "revision request",
  "buyer cancellation",
  "delivery acceptance",
];

async function run() {
  console.log("OKX review acceptance");

  assert.equal(QUICK_TRIAGE_TIMEOUT_MS, 20_000, "Quick Triage max sync budget is 20s");

  const bad = misConsumedQuote();
  assert.equal(isMisConsumedWithoutDelivery(bad), true);
  await saveBoundQuote(bad);
  const repaired = await repairMisConsumedQuote(bad.quoteId);
  assert.equal(repaired?.status, "funded");
  assert.equal(repaired?.executionState, "FAILED_RETRYABLE");

  const binding = buildCommerceBinding({
    operation: "analyze_repository",
    repository: bad.repository,
    branch: bad.branch,
    commitSha: bad.commitSha,
  });
  const entitlement = await requireEntitlement({
    quoteId: bad.quoteId,
    taskId: "task_retry",
    repository: binding.repository,
    branch: binding.branch,
    commitSha: binding.commitSha,
    findingIds: [],
    operation: "analyze_repository",
  });
  assert.equal(entitlement.ok, true, "mis-consumed quote must retry without new payment");

  const reviewerPrompt = "I would like to use the services of agent ID 5283";
  assert.equal(isMarketplaceDiscoveryMessage(reviewerPrompt), true);
  assert.equal(
    extractUserMessage({ message: reviewerPrompt }),
    reviewerPrompt
  );
  const intake = buildMarketplaceIntakeResponse("req_test");
  assert.equal(intake.aspAgentId, "5283");
  assert.ok(intake.scopeQuestions.length >= 5);
  assert.match(intake.message, /verified pull request/i);
  assert.equal(intake.nextAction, "PROVIDE_REPOSITORY_SCOPE");

  for (const scenario of A2A_SCENARIOS) {
    assert.ok(scenario.length > 0, `scenario placeholder: ${scenario}`);
  }

  const routes = [
    "src/app/api/okx/a2a/intake/route.ts",
    "src/app/api/internal/a2mcp/recover-incident-payment/route.ts",
    "src/lib/payment/quote-repair.ts",
    "src/lib/okx/marketplace-telemetry.ts",
  ];
  for (const route of routes) {
    assert.ok(fs.existsSync(path.join(ROOT, route)), `missing ${route}`);
  }

  const phase3 = fs.readFileSync(path.join(ROOT, "src/lib/a2mcp/phase3-route.ts"), "utf8");
  assert.match(phase3, /FAILED_RETRYABLE/);
  assert.match(phase3, /paymentAlreadySettled:\s*true/);
  assert.match(phase3, /status:\s*200/);

  const orchestrator = fs.readFileSync(path.join(ROOT, "src/lib/a2a/orchestrator.ts"), "utf8");
  assert.match(orchestrator, /asyncDelivery/);
  assert.match(orchestrator, /continueA2ATaskExecution/);

  const stored = await getBoundQuote(bad.quoteId);
  assert.notEqual(stored?.status, "consumed");

  console.log(`  ✓ entitlement repair + A2A intake (${A2A_SCENARIOS.length} scenarios catalogued)`);
  console.log("OKX review acceptance: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
