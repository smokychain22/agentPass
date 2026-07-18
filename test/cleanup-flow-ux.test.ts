import assert from "node:assert/strict";
import {
  automationBlockReason,
  plainLanguageTitle,
  plainLanguageWhatChanges,
  plainLanguageWhy,
  plainRiskLabel,
} from "../src/lib/findings/plain-language";
import { selectionPurposeOf } from "../src/lib/findings/selection-purposes";
import type { Finding } from "../src/lib/findings/types";
import {
  deliveryFailureRecovery,
  deliveryProgressSteps,
  deliveryUiPhase,
} from "../src/lib/workflow/delivery-progress";
import type { WorkflowA2ATask } from "../src/lib/workflow/client";
import { withTimeout } from "../src/lib/wallet/with-timeout";

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    await fn();
    console.log(`  ✓ ${name}`);
  })();
}

function finding(partial: Partial<Finding> & Pick<Finding, "id" | "action" | "type">): Finding {
  return {
    title: partial.title ?? "Unused file",
    files: partial.files ?? ["src/unused/confirmed-unused.ts"],
    confidence: 0.95,
    confidenceReason: "test",
    severity: "low",
    reason: "test",
    source: "knip",
    sourceMode: "native",
    evidence: {
      summary: "unused",
      signals: partial.evidence?.signals ?? ["inbound_refs=0", "unused"],
    },
    ...partial,
  };
}

function task(partial: Partial<WorkflowA2ATask> & Pick<WorkflowA2ATask, "status">): WorkflowA2ATask {
  return {
    taskId: "task_test",
    type: "cleanup_pr",
    purchaseChannel: "direct_site",
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
  console.log("cleanup-flow-ux tests");

  await test("plain language unused file copy", () => {
    const f = finding({
      id: "fnd_1",
      action: "safe_candidate",
      type: "unused_file",
      evidence: {
        summary: "unused",
        signals: ["inbound_refs=0", "classification=actionable_candidate", "unused"],
      },
    });
    assert.equal(plainLanguageTitle(f), "Remove confirmed unused file");
    assert.match(plainLanguageWhy(f), /not imported or referenced/i);
    assert.match(plainLanguageWhatChanges(f), /remove only this file/i);
    assert.equal(plainRiskLabel(f), "Safe cleanup");
    assert.equal(automationBlockReason(f), null);
  });

  await test("safe but non-eligible findings go to review purpose with block reason", () => {
    const f = finding({
      id: "fnd_review_safe",
      action: "safe_candidate",
      type: "unused_file",
      evidence: { summary: "weak", signals: ["unused"] },
    });
    assert.equal(selectionPurposeOf(f), "review");
    assert.match(automationBlockReason(f) ?? "", /Needs review|Not eligible/i);
  });

  await test("delivery UI phases resolve to terminal labels", () => {
    assert.equal(
      deliveryUiPhase({
        githubConnected: true,
        walletConnected: false,
        walletOnCorrectNetwork: false,
        hasQuote: true,
        task: task({ status: "awaiting_payment" }),
      }),
      "awaiting_wallet"
    );
    assert.equal(
      deliveryUiPhase({
        githubConnected: true,
        walletConnected: true,
        walletOnCorrectNetwork: true,
        hasQuote: true,
        task: task({ status: "awaiting_payment" }),
      }),
      "awaiting_payment"
    );
    assert.equal(
      deliveryUiPhase({
        githubConnected: true,
        walletConnected: true,
        walletOnCorrectNetwork: true,
        hasQuote: true,
        task: task({ status: "verifying" }),
      }),
      "verification_running"
    );
    assert.equal(
      deliveryUiPhase({
        githubConnected: true,
        walletConnected: true,
        walletOnCorrectNetwork: true,
        hasQuote: true,
        task: task({
          status: "delivery_ready",
          pullRequest: { url: "https://github.com/o/r/pull/1", number: 1, branch: "cleanup" },
        }),
      }),
      "pr_created"
    );
    assert.equal(
      deliveryUiPhase({
        githubConnected: true,
        walletConnected: true,
        walletOnCorrectNetwork: true,
        hasQuote: true,
        task: task({ status: "verification_failed", error: "baseline failed" }),
      }),
      "failed"
    );
  });

  await test("delivery progress steps mark active work", () => {
    const steps = deliveryProgressSteps(task({ status: "generating_changes" }));
    assert.equal(steps[0]?.done, true); // payment confirmed
    assert.ok(steps.some((s) => s.active && !s.done));
  });

  await test("failure recovery explains payment and retry safety", () => {
    const recovery = deliveryFailureRecovery(
      task({ status: "delivery_failed", error: "Worker crashed during apply." })
    );
    assert.ok(recovery);
    assert.equal(recovery!.paymentConfirmed, true);
    assert.equal(recovery!.repositoryFilesChanged, false);
    assert.equal(recovery!.retrySafe, true);
    assert.match(recovery!.nextStep, /without paying again/i);
  });

  await test("withTimeout rejects hanging promises", async () => {
    await assert.rejects(
      () => withTimeout(new Promise(() => undefined), 20, "timed out for test"),
      /timed out for test/
    );
  });

  await test("withTimeout resolves fast promises", async () => {
    const value = await withTimeout(Promise.resolve(42), 1000, "should not time out");
    assert.equal(value, 42);
  });

  console.log("cleanup-flow-ux: ok");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
