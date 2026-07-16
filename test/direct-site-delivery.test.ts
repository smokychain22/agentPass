import assert from "node:assert/strict";
import { reviewDirectSiteDelivery } from "../src/lib/a2a/direct-site-lifecycle";
import { saveA2ATask } from "../src/lib/a2a/task-store";
import type { A2ATaskRecord } from "../src/lib/a2a/types";
import {
  directTaskBelongsToSession,
  hashTaskOwnerSession,
} from "../src/lib/workflow/task-access";

async function run() {
  console.log("direct-site delivery lifecycle");
  const sessionKey = `browser:test-${Date.now()}`;
  const task: A2ATaskRecord = {
    id: `task_direct_${Date.now()}`,
    type: "repository.cleanup_pr",
    status: "delivery_ready",
    repository: { owner: "customer", name: "application", branch: "main" },
    input: {
      repoUrl: "https://github.com/customer/application",
      purchaseChannel: "direct_site",
      ownerSessionKeyHash: hashTaskOwnerSession(sessionKey),
      payer: "0x1111111111111111111111111111111111111111",
    },
    result: {
      pullRequest: { url: "https://github.com/customer/application/pull/7", number: 7 },
    },
    transitions: [
      { status: "submitted", at: new Date().toISOString(), role: "orchestrator" },
      { status: "delivery_ready", at: new Date().toISOString(), role: "ci_monitor" },
    ],
    limitations: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveA2ATask(task);

  assert.equal(directTaskBelongsToSession(task, sessionKey), true);
  assert.equal(directTaskBelongsToSession(task, "browser:someone-else"), false);

  const changesRequested = await reviewDirectSiteDelivery(task.id, {
    decision: "request_changes",
    note: "Keep the public export.",
  });
  assert.equal(changesRequested.status, "owner_action_required");

  const accepted = await reviewDirectSiteDelivery(task.id, { decision: "accept" });
  assert.equal(accepted.status, "completed");
  assert.ok(accepted.result.settlement?.buyerAcceptedAt);
  assert.equal(accepted.result.settlement?.escrowReleasedAt, undefined);

  console.log("direct-site delivery lifecycle: all passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
