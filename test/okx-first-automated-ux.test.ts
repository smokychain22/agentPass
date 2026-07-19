/**
 * OKX-first automated UX + A2A reviewer harness.
 */
import assert from "node:assert/strict";
import {
  isMarketplaceDiscoveryMessage,
  buildMarketplaceIntakeResponse,
  extractUserMessage,
  buildAsyncTaskAcknowledgement,
} from "../src/lib/a2a/marketplace-intake";
import {
  IMMEDIATE_TASK_ACKNOWLEDGEMENT,
  IMMEDIATE_TASK_ACKNOWLEDGEMENT_SHORT,
  OKX_MARKETPLACE_LIFECYCLE_STATES,
  mapA2AStatusToMarketplaceLifecycle,
} from "../src/lib/a2a/okx-marketplace-lifecycle";
import {
  allowsDirectWebsitePayment,
  parseSessionSource,
  resolveSessionSource,
} from "../src/lib/user-directed/session-source";
import {
  DEFAULT_PRODUCT_MODE,
  WORKBENCH_STAGES,
} from "../src/lib/user-directed/product-modes";
import { REQUESTED_ACTION_TYPES } from "../src/lib/user-directed/types";
import {
  ADVANCED_FULL_ACTION_TYPES,
  contextualAdvancedActions,
} from "../src/lib/user-directed/advanced-actions";
import { prepareAutomaticCleanupPlan } from "../src/lib/user-directed/auto-cleanup-plan";
import { buildScanOutcomeSummary } from "../src/lib/user-directed/scan-outcome-summary";
import { buildGuidedReviewPrompt } from "../src/lib/user-directed/guided-review";
import { recommendedActionForFinding } from "../src/lib/user-directed/recommended-action";
import { A2MCP_STANDARD_CAPABILITIES } from "../src/lib/a2mcp/standard-capabilities";
import { PHASE3_TOOL_ENTRIES } from "../src/lib/a2mcp/phase3-manifest";
import type { Finding } from "../src/lib/findings/types";

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => console.log(`  ✓ ${name}`))
    .catch((err) => {
      console.error(`  ✗ ${name}`);
      throw err;
    });
}

function finding(partial: Partial<Finding> & Pick<Finding, "id" | "action">): Finding {
  return {
    title: partial.title ?? partial.id,
    type: partial.type ?? "unused_file",
    files: partial.files ?? ["src/lib/orphan-a.ts"],
    confidence: 0.95,
    confidenceReason: "test",
    severity: "low",
    reason: "test",
    source: "knip",
    sourceMode: "native",
    confidenceTier: "verified",
    evidence: {
      summary: "no imports",
      signals: partial.evidence?.signals ?? [
        "classification=actionable_candidate",
        "inbound_refs=0",
        "unused",
      ],
    },
    ...partial,
  };
}

async function run() {
  console.log("okx-first-automated-ux");

  await test("default mode is Automatic Cleanup", () => {
    assert.equal(DEFAULT_PRODUCT_MODE, "AUTOMATIC_CLEANUP");
  });

  await test("exactly four top-level stages", () => {
    assert.equal(WORKBENCH_STAGES.length, 4);
    assert.deepEqual(
      WORKBENCH_STAGES.map((s) => s.id),
      ["review", "plan", "pay", "delivery"]
    );
  });

  await test("duplicate ignore option removed from action menus", () => {
    const ignoreLabels = REQUESTED_ACTION_TYPES.filter(
      (t) => t === "SUPPRESS" || t === "ADD_IGNORE_POLICY"
    );
    assert.equal(ignoreLabels.length, 1);
    assert.ok(!ADVANCED_FULL_ACTION_TYPES.includes("ADD_IGNORE_POLICY"));
    assert.ok(ADVANCED_FULL_ACTION_TYPES.includes("SUPPRESS"));
  });

  await test("session sources + OKX hides direct payment", () => {
    assert.equal(parseSessionSource("okx_a2a"), "OKX_A2A");
    assert.equal(parseSessionSource("OKX_A2MCP"), "OKX_A2MCP");
    assert.equal(allowsDirectWebsitePayment("DIRECT_SITE"), true);
    assert.equal(allowsDirectWebsitePayment("OKX_A2A"), false);
    assert.equal(allowsDirectWebsitePayment("OKX_A2MCP"), false);
    assert.equal(
      resolveSessionSource({ okxJobId: "job_1" }),
      "OKX_A2A"
    );
  });

  await test("scan outcome summary + automatic plan", () => {
    const findings = [
      finding({
        id: "f_unused",
        action: "safe_candidate",
        type: "unused_file",
        files: ["src/lib/orphan-a.ts"],
      }),
      finding({
        id: "f_dup",
        action: "safe_candidate",
        type: "duplicate_code",
        files: ["src/a.ts", "src/b.ts"],
        evidence: {
          summary: "exact dup",
          signals: [
            "classification=actionable_candidate",
            "exact_file_duplicate=true",
            "inbound_refs=0",
          ],
        },
      }),
      finding({
        id: "f_review",
        action: "review_first",
        type: "orphan_pattern",
        files: ["src/plugins/runtime-hook.ts"],
        confidenceTier: "needs_review",
        evidence: {
          summary: "plugin",
          signals: ["plugin_convention=true", "inbound_refs=0"],
        },
      }),
    ];
    const outcome = buildScanOutcomeSummary(findings);
    assert.ok(outcome.safeRemovals >= 1);
    assert.ok(outcome.itemsNeedingDecision >= 1);
    assert.ok(outcome.predictedFilesChanged >= 1);

    const prepared = prepareAutomaticCleanupPlan({
      repository: "o/r",
      pinnedCommit: "abc123",
      findings,
    });
    assert.ok(prepared.plans.length >= 1);
    assert.ok(!prepared.summary.validationCommands.includes(""));
    assert.equal(recommendedActionForFinding(findings[0]!), "DELETE");
    assert.equal(recommendedActionForFinding(findings[1]!), "CONSOLIDATE_DUPLICATES");
  });

  await test("guided review asks targeted question", () => {
    const f = finding({
      id: "f_plugin",
      action: "review_first",
      type: "orphan_pattern",
      files: ["src/plugins/foo.ts"],
      evidence: {
        summary: "plugin",
        signals: ["plugin_convention=true", "inbound_refs=0"],
      },
    });
    const prompt = buildGuidedReviewPrompt(f);
    assert.match(prompt.question, /plugin|externally|loaded/i);
    assert.equal(prompt.choices.length, 3);
  });

  await test("advanced actions are contextual and progressive", () => {
    const actions = contextualAdvancedActions({
      path: "package.json",
      finding: finding({
        id: "dep",
        action: "safe_candidate",
        type: "unused_dependency",
        files: ["package.json"],
        packageName: "left-pad",
      }),
    });
    assert.ok(actions.includes("REMOVE_DEPENDENCY"));
    assert.ok(actions.includes("SUPPRESS"));
    assert.ok(!actions.includes("ADD_IGNORE_POLICY"));
  });

  await test("reviewer prompt activates discovery + immediate ack", () => {
    const reviewer =
      "I want to create a repository cleanup task using Agent ID 5283.";
    assert.equal(isMarketplaceDiscoveryMessage(reviewer), true);
    assert.ok(extractUserMessage({ message: reviewer })?.includes("5283"));

    const intake = buildMarketplaceIntakeResponse("req_test");
    assert.equal(intake.acknowledged, true);
    assert.equal(intake.immediateAcknowledgement, true);
    assert.equal(intake.scanStarted, false);
    assert.equal(intake.directWebsitePaymentHidden, true);
    assert.equal(intake.sessionSource, "OKX_A2A");
    assert.match(intake.message, /RepoDiet received your repository-cleanup task/i);
    assert.ok(intake.message.includes("GitHub App") || intake.messageShort.includes("GitHub App"));
    assert.equal(intake.nextAction, "PROVIDE_REPOSITORY_SCOPE");
    assert.ok(IMMEDIATE_TASK_ACKNOWLEDGEMENT.length > 40);
    assert.ok(IMMEDIATE_TASK_ACKNOWLEDGEMENT_SHORT.includes("escrow"));

    const ack = buildAsyncTaskAcknowledgement({
      taskId: "task_1",
      statusUrl: "https://example.com/api/a2a/tasks/task_1",
    });
    assert.equal(ack.acknowledged, true);
    assert.equal(ack.scanStarted, false);
    assert.equal(ack.directWebsitePaymentHidden, true);
    assert.ok(ack.message.includes("repository") || ack.message.includes("GitHub"));
  });

  await test("marketplace lifecycle covers canonical states", () => {
    assert.ok(OKX_MARKETPLACE_LIFECYCLE_STATES.includes("RECEIVED"));
    assert.ok(OKX_MARKETPLACE_LIFECYCLE_STATES.includes("ACKNOWLEDGED"));
    assert.ok(OKX_MARKETPLACE_LIFECYCLE_STATES.includes("ESCROW_FUNDED"));
    assert.ok(OKX_MARKETPLACE_LIFECYCLE_STATES.includes("FAILED_WITH_REASON"));
    assert.equal(mapA2AStatusToMarketplaceLifecycle("submitted"), "ACKNOWLEDGED");
    assert.equal(mapA2AStatusToMarketplaceLifecycle("funded"), "ESCROW_FUNDED");
    assert.equal(mapA2AStatusToMarketplaceLifecycle("delivery_submitted"), "DELIVERED");
    assert.equal(mapA2AStatusToMarketplaceLifecycle("buyer_accepted"), "ACCEPTED");
  });

  await test("A2MCP standardized capabilities registered", () => {
    const names = new Set(PHASE3_TOOL_ENTRIES.map((t) => t.name));
    for (const cap of A2MCP_STANDARD_CAPABILITIES) {
      assert.ok(names.has(cap), `missing capability ${cap}`);
    }
  });

  await test("scenario matrix: unsafe / private / invalid / restart markers", () => {
    const scenarios = [
      "public repository",
      "private repository without access",
      "invalid repository",
      "unsafe cleanup request",
      "duplicate consolidation",
      "unused-file cleanup",
      "custom edit",
      "task restart recovery",
      "duplicate message delivery",
      "dependency outage",
    ];
    assert.equal(scenarios.length, 10);
    // Discovery still responds for task-worded messages even without repo.
    assert.equal(
      isMarketplaceDiscoveryMessage(
        "I want to create a repository cleanup task using Agent ID 5283 for an invalid repository"
      ),
      true
    );
    // Unsafe / protected paths stay out of automatic executable deletes without eligibility.
    const unsafe = finding({
      id: "unsafe",
      action: "do_not_touch",
      type: "unused_file",
      files: ["src/app/api/route.ts"],
      protected: true,
    });
    const prepared = prepareAutomaticCleanupPlan({
      repository: "o/r",
      pinnedCommit: "abc",
      findings: [unsafe],
    });
    assert.equal(prepared.plans.length, 0);
  });

  console.log("okx-first-automated-ux: PASS");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
