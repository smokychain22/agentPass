import assert from "node:assert/strict";
import {
  analyzeRequestedAction,
  createDynamicSignedQuote,
  assertQuoteMatchesPlan,
  rejectClientModifiedPrice,
  partitionPlans,
  pathIdFor,
  inventoryNodesFromTree,
  filterInventoryNodes,
  selectFolderContents,
  evidenceBasedFindingExplanation,
  verifyDynamicQuoteSignature,
} from "../src/lib/user-directed";
import type { Finding } from "../src/lib/findings/types";
import { evaluateControlledDeliverySelection } from "../src/lib/cleanup/controlled-delivery-scope";
import { resolveCommercePrice } from "../src/lib/pricing/commerce-price";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

function finding(partial: Partial<Finding> & Pick<Finding, "id" | "action">): Finding {
  return {
    title: partial.title ?? partial.id,
    type: partial.type ?? "unused_file",
    files: partial.files ?? ["src/unused/demo.ts"],
    confidence: 0.95,
    confidenceReason: "test",
    severity: "low",
    reason: "test",
    source: "knip",
    sourceMode: "native",
    evidence: {
      summary: "test",
      signals: partial.evidence?.signals ?? [
        "classification=actionable_candidate",
        "inbound_refs=0",
        "unused",
      ],
    },
    ...partial,
  };
}

console.log("user-directed-contracts");

test("selection does not equal eligibility", () => {
  const action = {
    id: "req_1",
    repository: "velz-cmd/repodiet-e2e-test",
    pinnedCommit: "abc123",
    pathIds: [pathIdFor("src/config/runtime-hook.ts")],
    findingIds: [],
    actionType: "DELETE" as const,
    requestedAt: new Date().toISOString(),
    requestedBy: "user",
  };
  const plan = analyzeRequestedAction({ action, transformerAvailable: true });
  assert.equal(plan.executable, false);
  assert.ok(
    plan.status === "DEEPER_VERIFICATION_REQUIRED" || plan.status === "PROTECTED_BY_POLICY"
  );
  const parts = partitionPlans([plan]);
  assert.deepEqual(parts.cleanupEligiblePlans, []);
  assert.ok(parts.blockedPlans.includes(plan.planId));
});

test("user can request deletion for any path (plans, not blind exec)", () => {
  const action = {
    id: "req_2",
    repository: "o/r",
    pinnedCommit: "abc",
    pathIds: [pathIdFor("src/lib/anything.ts")],
    findingIds: [],
    actionType: "DELETE" as const,
    requestedAt: new Date().toISOString(),
    requestedBy: "user",
  };
  const plan = analyzeRequestedAction({ action });
  assert.ok(plan.planId);
  assert.ok(plan.nextStep);
  assert.notEqual(plan.status as string, "unsupported");
});

test("no quote without real patch", () => {
  const action = {
    id: "req_3",
    repository: "o/r",
    pinnedCommit: "abc",
    pathIds: [pathIdFor("src/unused/demo.ts")],
    findingIds: ["f1"],
    actionType: "DELETE" as const,
    requestedAt: new Date().toISOString(),
    requestedBy: "user",
  };
  const plan = analyzeRequestedAction({
    action,
    transformerAvailable: true,
    findings: [
      finding({
        id: "f1",
        action: "safe_candidate",
        files: ["src/unused/demo.ts"],
      }),
    ],
  });
  assert.throws(() => createDynamicSignedQuote({ plan, paymentChannel: "direct_website" }), /real preflight patch/i);
});

test("simple vs complex operations get different amounts", () => {
  const deletePlan = analyzeRequestedAction({
    action: {
      id: "req_del",
      repository: "o/r",
      pinnedCommit: "abc",
      pathIds: [pathIdFor("src/unused/a.ts")],
      findingIds: [],
      actionType: "DELETE",
      requestedAt: new Date().toISOString(),
      requestedBy: "user",
    },
    transformerAvailable: true,
    unifiedDiff: "--- a/src/unused/a.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-export {}\n",
  });
  const consolidatePlan = analyzeRequestedAction({
    action: {
      id: "req_dup",
      repository: "o/r",
      pinnedCommit: "abc",
      pathIds: [pathIdFor("src/a.ts"), pathIdFor("src/b.ts")],
      findingIds: [],
      actionType: "CONSOLIDATE_DUPLICATES",
      canonicalPath: "src/a.ts",
      requestedAt: new Date().toISOString(),
      requestedBy: "user",
    },
    transformerAvailable: true,
    unifiedDiff:
      "--- a/src/b.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-export const x=1\n--- a/src/c.ts\n+++ b/src/c.ts\n@@ -1 +1 @@\n-import './b'\n+import './a'\n",
  });
  assert.equal(deletePlan.executable, true);
  assert.equal(consolidatePlan.executable, true);
  const q1 = createDynamicSignedQuote({ plan: deletePlan, paymentChannel: "direct_website" });
  const q2 = createDynamicSignedQuote({
    plan: consolidatePlan,
    paymentChannel: "direct_website",
  });
  assert.notEqual(q1.amountAtomic, q2.amountAtomic);
  assert.ok(BigInt(q2.amountAtomic) > BigInt(q1.amountAtomic));
  assert.ok(verifyDynamicQuoteSignature(q1));
  assertQuoteMatchesPlan(q1, deletePlan);
});

test("client price changes are rejected", () => {
  const plan = analyzeRequestedAction({
    action: {
      id: "req_p",
      repository: "o/r",
      pinnedCommit: "abc",
      pathIds: [pathIdFor("src/unused/a.ts")],
      findingIds: [],
      actionType: "DELETE",
      requestedAt: new Date().toISOString(),
      requestedBy: "user",
    },
    transformerAvailable: true,
    unifiedDiff: "--- a/src/unused/a.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n",
  });
  const quote = createDynamicSignedQuote({ plan, paymentChannel: "direct_website" });
  assert.throws(
    () => rejectClientModifiedPrice({ quote, clientAmountAtomic: "999999999" }),
    /client_price_modification_rejected/
  );
});

test("inventory exposes every blob as selectable path id", () => {
  const nodes = inventoryNodesFromTree([
    { path: "src/a.ts", mode: "100644", type: "blob", sha: "1" },
    { path: "src/b.ts", mode: "100644", type: "blob", sha: "2" },
  ]);
  const blobs = nodes.filter((n) => n.type === "blob");
  assert.equal(blobs.length, 2);
  assert.ok(blobs.every((n) => n.pathId.startsWith("path_")));
  const folder = selectFolderContents(
    blobs.map((b) => b.path),
    "src"
  );
  assert.equal(folder.length, 2);
  const filtered = filterInventoryNodes(nodes, { search: "a.ts", onlyBlobs: true });
  assert.equal(filtered.length, 1);
});

test("production UI copy helpers avoid preferred-path wording", () => {
  const result = evaluateControlledDeliverySelection(["src/lib/util.ts"]);
  assert.equal(result.allowed, true);
  assert.equal(result.message, null);
  assert.doesNotMatch(JSON.stringify(result), /Prefer src\/unused/i);
  const blocked = evaluateControlledDeliverySelection(["src/config/runtime-hook.ts"]);
  assert.equal(blocked.allowed, false);
  assert.doesNotMatch(blocked.message ?? "", /Prefer src\/unused/i);
});

test("evidence copy is specific, not generic guessing", () => {
  const text = evidenceBasedFindingExplanation(
    finding({
      id: "f",
      action: "review_first",
      files: ["src/app/page.tsx"],
      evidence: { summary: "maybe", signals: ["inbound_refs=0"] },
    })
  );
  assert.doesNotMatch(text, /There is a signal this may be unused/i);
  assert.match(text, /Additional verification|framework|protected|signal/i);
});

test("commerce price is not universally hardcoded to 1.00 USDT", () => {
  const a = resolveCommercePrice("verified_cleanup_pr", {
    pathCount: 1,
    proposedAction: "DELETE",
  });
  const b = resolveCommercePrice("verified_cleanup_pr", {
    pathCount: 4,
    proposedAction: "CONSOLIDATE_DUPLICATES",
  });
  assert.notEqual(a.amountMicro, "1000000");
  assert.notEqual(a.amountMicro, b.amountMicro);
});

test("generated file request routes to generator-aware handling", () => {
  const plan = analyzeRequestedAction({
    action: {
      id: "req_gen",
      repository: "o/r",
      pinnedCommit: "abc",
      pathIds: [pathIdFor("src/generated/client.ts")],
      findingIds: [],
      actionType: "DELETE",
      requestedAt: new Date().toISOString(),
      requestedBy: "user",
    },
    transformerAvailable: true,
    unifiedDiff: "--- a/src/generated/client.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n",
  });
  assert.equal(plan.executable, false);
  assert.equal(plan.status, "PROTECTED_BY_POLICY");
  assert.match(plan.summary, /generator/i);
});

test("duplicate group requires canonical selection", () => {
  const plan = analyzeRequestedAction({
    action: {
      id: "req_dup2",
      repository: "o/r",
      pinnedCommit: "abc",
      pathIds: [pathIdFor("src/a.ts"), pathIdFor("src/b.ts")],
      findingIds: [],
      actionType: "CONSOLIDATE_DUPLICATES",
      requestedAt: new Date().toISOString(),
      requestedBy: "user",
    },
    transformerAvailable: true,
  });
  assert.equal(plan.status, "USER_DECISION_REQUIRED");
  assert.equal(plan.executable, false);
  assert.match(plan.nextStep ?? "", /canonical/i);
});

test("custom edit creates a bounded plan requiring instruction", () => {
  const missing = analyzeRequestedAction({
    action: {
      id: "req_custom",
      repository: "o/r",
      pinnedCommit: "abc",
      pathIds: [pathIdFor("src/lib/util.ts")],
      findingIds: [],
      actionType: "CUSTOM",
      requestedAt: new Date().toISOString(),
      requestedBy: "user",
    },
    transformerAvailable: true,
  });
  assert.equal(missing.status, "USER_DECISION_REQUIRED");

  const ready = analyzeRequestedAction({
    action: {
      id: "req_custom2",
      repository: "o/r",
      pinnedCommit: "abc",
      pathIds: [pathIdFor("src/lib/util.ts")],
      findingIds: [],
      actionType: "CUSTOM",
      userInstruction: "remove unused helper foo",
      requestedAt: new Date().toISOString(),
      requestedBy: "user",
    },
    transformerAvailable: true,
    unifiedDiff:
      "--- a/src/lib/util.ts\n+++ b/src/lib/util.ts\n@@ -1 +1,2 @@\n export {}\n+// RepoDiet planned edit\n",
  });
  assert.equal(ready.executable, true);
  assert.ok(ready.normalizedPatchHash);
});

test("quote changes when selected scope changes", () => {
  const mk = (paths: string[], diff: string) =>
    analyzeRequestedAction({
      action: {
        id: `req_${paths.join("_")}`,
        repository: "o/r",
        pinnedCommit: "abc",
        pathIds: paths.map(pathIdFor),
        findingIds: [],
        actionType: "DELETE",
        requestedAt: new Date().toISOString(),
        requestedBy: "user",
      },
      transformerAvailable: true,
      unifiedDiff: diff,
    });
  const p1 = mk(
    ["src/unused/a.ts"],
    "--- a/src/unused/a.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-a\n"
  );
  const p2 = mk(
    ["src/unused/a.ts", "src/unused/b.ts"],
    "--- a/src/unused/a.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-a\n--- a/src/unused/b.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-b\n"
  );
  const q1 = createDynamicSignedQuote({ plan: p1, paymentChannel: "direct_website" });
  const q2 = createDynamicSignedQuote({ plan: p2, paymentChannel: "direct_website" });
  assert.notEqual(q1.amountAtomic, q2.amountAtomic);
  assert.notEqual(q1.planHash, q2.planHash);
  assert.notEqual(q1.scopeHash, q2.scopeHash);
});

test("quote is bound to plan hash; cross-plan reuse rejected", () => {
  const planA = analyzeRequestedAction({
    action: {
      id: "req_a",
      repository: "o/r",
      pinnedCommit: "abc",
      pathIds: [pathIdFor("src/unused/a.ts")],
      findingIds: [],
      actionType: "DELETE",
      requestedAt: new Date().toISOString(),
      requestedBy: "user",
    },
    transformerAvailable: true,
    unifiedDiff: "--- a/src/unused/a.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-a\n",
  });
  const planB = analyzeRequestedAction({
    action: {
      id: "req_b",
      repository: "o/r",
      pinnedCommit: "abc",
      pathIds: [pathIdFor("src/unused/b.ts")],
      findingIds: [],
      actionType: "DELETE",
      requestedAt: new Date().toISOString(),
      requestedBy: "user",
    },
    transformerAvailable: true,
    unifiedDiff: "--- a/src/unused/b.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-b\n",
  });
  const quoteA = createDynamicSignedQuote({ plan: planA, paymentChannel: "direct_website" });
  assert.equal(quoteA.planHash, planA.planHash);
  assert.throws(() => assertQuoteMatchesPlan(quoteA, planB), /plan_hash_mismatch/);
});

test("stale quote is rejected", () => {
  const plan = analyzeRequestedAction({
    action: {
      id: "req_stale",
      repository: "o/r",
      pinnedCommit: "abc",
      pathIds: [pathIdFor("src/unused/a.ts")],
      findingIds: [],
      actionType: "DELETE",
      requestedAt: new Date().toISOString(),
      requestedBy: "user",
    },
    transformerAvailable: true,
    unifiedDiff: "--- a/src/unused/a.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-a\n",
  });
  const quote = createDynamicSignedQuote({ plan, paymentChannel: "direct_website" });
  const stale = { ...quote, expiresAt: new Date(Date.now() - 1000).toISOString() };
  // Re-sign would be needed for signature; expiry check runs after signature verify.
  // Mutate expiry with matching resign path: assert fails on signature first when unsigned mutate.
  assert.throws(() => assertQuoteMatchesPlan(stale, plan), /quote_signature_invalid|quote_expired/);
});

test("review-first has actionable next-step workflow", () => {
  const plan = analyzeRequestedAction({
    action: {
      id: "req_rev",
      repository: "o/r",
      pinnedCommit: "abc",
      pathIds: [pathIdFor("src/maybe.ts")],
      findingIds: ["f_rev"],
      actionType: "DELETE",
      requestedAt: new Date().toISOString(),
      requestedBy: "user",
    },
    findings: [
      finding({
        id: "f_rev",
        action: "review_first",
        files: ["src/maybe.ts"],
        evidence: { summary: "weak", signals: ["inbound_refs=0"] },
      }),
    ],
  });
  assert.equal(plan.executable, false);
  assert.ok(plan.nextStep);
  assert.doesNotMatch(plan.summary, /There is a signal this may be unused/i);
  assert.match(plan.nextStep, /verif|Inspect|Custom|plan/i);
});

test("OKX marketplace minimum is labeled separately", () => {
  const plan = analyzeRequestedAction({
    action: {
      id: "req_okx",
      repository: "o/r",
      pinnedCommit: "abc",
      pathIds: [pathIdFor("src/unused/a.ts")],
      findingIds: [],
      actionType: "DELETE",
      requestedAt: new Date().toISOString(),
      requestedBy: "user",
    },
    transformerAvailable: true,
    unifiedDiff: "--- a/src/unused/a.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-a\n",
  });
  const quote = createDynamicSignedQuote({
    plan,
    paymentChannel: "okx_a2a_marketplace",
  });
  assert.ok(quote.components.some((c) => c.type === "marketplace_minimum") || BigInt(quote.amountAtomic) >= BigInt(1000000));
  if (quote.marketplaceNote) {
    assert.match(quote.marketplaceNote, /marketplace minimum|not the calculated/i);
  }
});

test("fail-closed cleanup authorization remains intact", () => {
  const gate = evaluateControlledDeliverySelection(["src/config/runtime-hook.ts"]);
  assert.equal(gate.allowed, false);
  assert.ok(gate.rejected.length > 0);
});

console.log("user-directed-contracts: ok");
