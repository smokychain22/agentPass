import assert from "node:assert/strict";
import {
  deliveryProgressSteps,
  deliveryUiPhase,
} from "../src/lib/workflow/delivery-progress";
import { formatWorkflowQuote } from "../src/lib/workflow/format-workflow-quote";
import type { BoundQuote } from "../src/lib/payment/types";
import type { WorkflowA2ATask } from "../src/lib/workflow/client";
import { getCanonicalOkxIdentityPublic } from "../src/lib/okx/identity-public";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    await fn();
    console.log(`  ✓ ${name}`);
  })();
}

function task(partial: Partial<WorkflowA2ATask> & Pick<WorkflowA2ATask, "status">): WorkflowA2ATask {
  return {
    taskId: "task_okx",
    type: "cleanup_pr",
    purchaseChannel: "okx_marketplace",
    repository: {
      owner: "velz-cmd",
      name: "repodiet-e2e-test",
      branch: "main",
      commitSha: "c0838e4cda326098a363b44e0e3ebe98e81e9463",
    },
    transitions: [],
    ...partial,
  };
}

async function run() {
  console.log("okx-a2a-escrow-rails tests");

  await test("public identity exposes A2A 32947", () => {
    const id = getCanonicalOkxIdentityPublic();
    assert.equal(id.a2aServiceId, 32947);
    assert.equal(id.aspAgentId, 5283);
  });

  await test("workflow quotes default to escrow payment model", () => {
    const quote = formatWorkflowQuote({
      quoteId: "q1",
      amountMicro: "1000000",
      currency: "USDT",
      network: "eip155:196",
      recipient: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
      asset: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      operation: "create_cleanup_pr",
      repository: "velz-cmd/repodiet-e2e-test",
      commitSha: "abc",
      findingIds: ["f1"],
      branch: "main",
      nonce: "n1",
      requestHash: "h1",
      status: "quoted",
      lifecycleStatus: "quote_created",
      createdAt: new Date().toISOString(),
    } as unknown as BoundQuote);
    assert.equal(quote.paymentModel, "escrow");
  });

  await test("delivery phases use OKX escrow vocabulary", () => {
    assert.equal(
      deliveryUiPhase({
        githubConnected: true,
        hasQuote: true,
        task: task({ status: "awaiting_payment" }),
      }),
      "awaiting_escrow_funding"
    );
    assert.equal(
      deliveryUiPhase({
        githubConnected: true,
        hasQuote: true,
        task: task({ status: "funded" }),
      }),
      "escrow_funded"
    );
    assert.equal(
      deliveryUiPhase({
        githubConnected: true,
        hasQuote: true,
        task: task({
          status: "delivery_submitted",
          pullRequest: { url: "https://github.com/o/r/pull/1" },
        }),
      }),
      "awaiting_acceptance"
    );
    assert.equal(
      deliveryUiPhase({
        githubConnected: true,
        hasQuote: true,
        task: task({ status: "completed" }),
      }),
      "accepted_and_released"
    );
    assert.equal(
      deliveryUiPhase({
        githubConnected: true,
        hasQuote: true,
        task: task({ status: "disputed" }),
      }),
      "disputed"
    );
  });

  await test("progress steps include authorize, escrow, accept, release", () => {
    const steps = deliveryProgressSteps(task({ status: "awaiting_payment" }));
    assert.ok(steps.some((s) => /Authorize RepoDiet A2A/i.test(s.label)));
    assert.ok(steps.some((s) => /Fund OKX escrow/i.test(s.label)));
    assert.ok(steps.some((s) => /Accepted and released/i.test(s.label)));
  });

  await test("Fix & PR UI no longer advertises direct payment", () => {
    const flow = fs.readFileSync(
      path.join(ROOT, "src/components/app/fix-pr/fix-pr-a2a-flow.tsx"),
      "utf8"
    );
    assert.match(flow, /OkxEscrowPanel/);
    assert.doesNotMatch(flow, /Direct payment \(not escrow\)/i);
    assert.doesNotMatch(flow, /PaymentAuthorizationPanel/);
    assert.match(flow, /okx_marketplace|OKX A2A escrow|fundOkxEscrowTask/);
  });

  await test("workflow a2a route creates marketplace channel", () => {
    const route = fs.readFileSync(
      path.join(ROOT, "src/app/api/workflow/a2a/route.ts"),
      "utf8"
    );
    assert.match(route, /purchaseChannel:\s*"okx_marketplace"/);
    assert.doesNotMatch(route, /purchaseChannel:\s*"direct_site"/);
  });

  console.log("okx-a2a-escrow-rails: ok");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
