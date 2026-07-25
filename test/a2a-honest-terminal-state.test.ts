import assert from "node:assert/strict";
import {
  formatA2ATaskResponse,
  isApprovedDeliveryRetryEligible,
} from "../src/lib/a2a/orchestrator";
import { isTerminalA2AStatus } from "../src/lib/a2a/task-state-machine";
import type { A2ATaskRecord, A2ATaskStatus } from "../src/lib/a2a/types";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

function taskWithStatus(status: A2ATaskStatus): A2ATaskRecord {
  return {
    id: "task_honesty_test",
    type: "repository.cleanup_pr",
    status,
    repository: { owner: "smokychain22", name: "repodiet-e2e-test", branch: "main" },
    input: { repoUrl: "https://github.com/smokychain22/repodiet-e2e-test", branch: "main" },
    result: {},
    transitions: [{ status, at: new Date().toISOString(), role: "orchestrator" }],
    limitations: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function run() {
  console.log("A2A honest terminal state");

  test("payment_failed is recoverable, not terminal", () => {
    const r = formatA2ATaskResponse(taskWithStatus("payment_failed"));
    assert.equal(r.terminal, false, "payment_failed must not be reported terminal — /continue recovers it");
    assert.equal(r.nextAction, "RETRY_CONTINUE");
  });

  test("analysis_failed is recoverable, not terminal", () => {
    const r = formatA2ATaskResponse(taskWithStatus("analysis_failed"));
    assert.equal(r.terminal, false);
    assert.equal(r.nextAction, "RETRY_CONTINUE");
  });

  test("verification_failed and delivery_failed are recoverable, not terminal", () => {
    assert.equal(formatA2ATaskResponse(taskWithStatus("verification_failed")).terminal, false);
    assert.equal(formatA2ATaskResponse(taskWithStatus("delivery_failed")).terminal, false);
  });

  test("delivery retry requires prior funding, approval, verification, and a prepared patch", () => {
    const eligible = taskWithStatus("delivery_failed");
    eligible.approval = {
      summary: "Approved cleanup scope",
      repository: "smokychain22/repodiet-e2e-test",
      branch: "repodiet/cleanup-task_honesty_test",
      changes: [],
      unifiedDiff: "",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    eligible.result = {
      verification: { status: "verified", checks: [] },
      changes: {
        changedFiles: ["unused.ts"],
        unifiedDiff: "diff --git a/unused.ts b/unused.ts",
        patchKitId: "patchkit_retry",
      },
    };
    eligible.transitions = [
      { status: "funded", at: new Date().toISOString(), role: "orchestrator" },
      {
        status: "creating_pull_request",
        at: new Date().toISOString(),
        role: "github_delivery_worker",
      },
      {
        status: "delivery_failed",
        at: new Date().toISOString(),
        role: "github_delivery_worker",
      },
    ];

    assert.equal(isApprovedDeliveryRetryEligible(eligible), true);

    const unpaid = structuredClone(eligible);
    unpaid.transitions = unpaid.transitions.filter((transition) => transition.status !== "funded");
    assert.equal(isApprovedDeliveryRetryEligible(unpaid), false);

    const unverified = structuredClone(eligible);
    unverified.result.verification = { status: "failed", checks: [] };
    assert.equal(isApprovedDeliveryRetryEligible(unverified), false);
  });

  test("checks_failed is recoverable, not terminal", () => {
    assert.equal(formatA2ATaskResponse(taskWithStatus("checks_failed")).terminal, false);
  });

  test("genuinely dead-end statuses are terminal", () => {
    for (const status of ["completed", "rejected", "unsupported", "cancelled", "expired"] as const) {
      assert.equal(
        formatA2ATaskResponse(taskWithStatus(status)).terminal,
        true,
        `${status} must be terminal`
      );
    }
  });

  test("completed and escrow_released map to DONE; genuine dead-ends map to INSPECT_FAILURE", () => {
    assert.equal(formatA2ATaskResponse(taskWithStatus("completed")).nextAction, "DONE");
    assert.equal(formatA2ATaskResponse(taskWithStatus("escrow_released")).nextAction, "DONE");
    assert.equal(formatA2ATaskResponse(taskWithStatus("rejected")).nextAction, "INSPECT_FAILURE");
  });

  test("terminal flag is derived from the state machine, not a hand-maintained list", () => {
    // Every status the state machine actually treats as a dead end must
    // exactly match what the public API reports as terminal, and vice versa —
    // except escrow_released, a deliberate exception: nothing is left for a
    // buyer/seller to act on once escrow releases, even though the record
    // still auto-advances to completed as pure bookkeeping.
    const allStatuses: A2ATaskStatus[] = [
      "submitted", "validating", "quote_required", "awaiting_payment", "funded",
      "queued", "fetching_repository", "analyzing", "awaiting_approval",
      "generating_changes", "validating_patch", "verifying", "creating_pull_request",
      "monitoring_checks", "checks_failed", "diagnosis_ready", "owner_action_required",
      "delivery_ready", "delivery_submitted", "buyer_accepted", "escrow_released",
      "completed", "rejected", "disputed", "unsupported", "payment_failed",
      "analysis_failed", "verification_failed", "delivery_failed", "cancelled", "expired",
    ];
    for (const status of allStatuses) {
      const expected = isTerminalA2AStatus(status) || status === "escrow_released";
      assert.equal(
        formatA2ATaskResponse(taskWithStatus(status)).terminal,
        expected,
        `terminal flag for ${status} must match the state machine`
      );
    }
  });

  console.log("A2A honest terminal state: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
