import assert from "node:assert/strict";
import {
  acceptA2aDeliveryByBuyer,
  describeA2aLifecycle,
  disputeA2aDeliveryByBuyer,
  recordA2aEscrowRelease,
  rejectA2aDeliveryByBuyer,
  submitA2aDeliveryEvidence,
} from "../src/lib/a2a/settlement-lifecycle";
import { saveA2ATask } from "../src/lib/a2a/task-store";
import type { A2ATaskRecord } from "../src/lib/a2a/types";
import { A2A_TERMINAL_STATUSES } from "../src/lib/a2a/types";

async function run() {
  console.log("a2a settlement lifecycle");

  const steps = describeA2aLifecycle();
  assert.equal(steps[0], "buyer creates A2A task");
  assert.equal(steps[steps.length - 1], "receipt and task evidence are recorded");
  assert.equal(A2A_TERMINAL_STATUSES.includes("delivery_ready"), false);

  const taskId = `task_lifecycle_${Date.now()}`;
  const base: A2ATaskRecord = {
    id: taskId,
    type: "repository.cleanup_pr",
    status: "delivery_ready",
    repository: { owner: "smokychain22", name: "repodiet-e2e-test", branch: "main" },
    input: {
      repoUrl: "https://github.com/smokychain22/repodiet-e2e-test",
      branch: "main",
    },
    result: {
      pullRequest: {
        url: "https://github.com/smokychain22/repodiet-e2e-test/pull/1",
        number: 1,
        branch: "repodiet/cleanup-demo",
        title: "chore: verified cleanup",
      },
      receipt: { receiptId: "receipt_demo" },
    },
    transitions: [
      { status: "submitted", at: new Date().toISOString(), role: "orchestrator" },
      { status: "delivery_ready", at: new Date().toISOString(), role: "ci_monitor" },
    ],
    limitations: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveA2ATask(base);

  const submitted = await submitA2aDeliveryEvidence(taskId);
  assert.equal(submitted.status, "delivery_submitted");
  assert.ok(submitted.result.settlement?.deliveryId);

  const accepted = await acceptA2aDeliveryByBuyer(taskId, {
    buyerWallet: "0xaa895234c3fc31c40018eef975db6ac79bf87f1a",
    okxAcceptanceReference: "okx_accept_demo",
  });
  assert.equal(accepted.status, "buyer_accepted");
  assert.equal(
    accepted.result.settlement?.buyerWallet,
    "0xaa895234c3fc31c40018eef975db6ac79bf87f1a"
  );

  const released = await recordA2aEscrowRelease(taskId, {
    escrowReleaseReference: "okx_escrow_release_demo",
  });
  assert.equal(released.status, "completed");
  assert.equal(released.result.settlement?.escrowReleaseReference, "okx_escrow_release_demo");
  assert.ok(released.completedAt);

  const rejectId = `task_reject_${Date.now()}`;
  await saveA2ATask({
    ...base,
    id: rejectId,
    status: "delivery_submitted",
    input: { ...base.input, purchaseChannel: "okx_marketplace" },
    result: {
      ...base.result,
      settlement: { deliveryId: "delivery_reject_demo" },
    },
    transitions: [
      { status: "delivery_submitted", at: new Date().toISOString(), role: "orchestrator" },
    ],
  });
  const rejected = await rejectA2aDeliveryByBuyer(rejectId, { reason: "scope mismatch" });
  assert.equal(rejected.status, "rejected");

  const disputeId = `task_dispute_${Date.now()}`;
  await saveA2ATask({
    ...base,
    id: disputeId,
    status: "delivery_submitted",
    input: { ...base.input, purchaseChannel: "okx_marketplace" },
    result: {
      ...base.result,
      settlement: { deliveryId: "delivery_dispute_demo" },
    },
    transitions: [
      { status: "delivery_submitted", at: new Date().toISOString(), role: "orchestrator" },
    ],
  });
  const disputed = await disputeA2aDeliveryByBuyer(disputeId, {
    buyerWallet: "0xaa895234c3fc31c40018eef975db6ac79bf87f1a",
    reason: "quality dispute",
  });
  assert.equal(disputed.status, "disputed");
  assert.ok(disputed.result.settlement?.disputeOpenedAt);

  console.log("a2a settlement lifecycle: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
