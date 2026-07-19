#!/usr/bin/env tsx
/**
 * Strict production canary — fails closed.
 * Does NOT accept unsigned receipts, demo payments, or missing-token PR delivery as success.
 *
 * Usage:
 *   REPODIET_PRODUCTION_URL=https://skillswap-virid-kappa.vercel.app \
 *   npx tsx scripts/strict-production-canary.ts
 */
const BASE =
  process.env.REPODIET_PRODUCTION_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "https://skillswap-virid-kappa.vercel.app";

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

async function main() {
  console.log(`Strict production canary: ${BASE}`);

  const t0 = Date.now();
  const discovery = await fetch(`${BASE}/api/a2a/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "I would like to use the services of agent ID 5283",
    }),
  });
  const discoveryMs = Date.now() - t0;
  const discoveryJson = await discovery.json();
  record("A2A discovery HTTP 200", discovery.ok, `status=${discovery.status}`);
  record("A2A discovery under 5s", discoveryMs < 5000, `${discoveryMs}ms`);
  record(
    "A2A discovery useful response",
    Boolean(discoveryJson.nextAction === "PROVIDE_REPOSITORY_SCOPE" || discoveryJson.acknowledged),
    discoveryJson.nextAction || discoveryJson.message?.slice?.(0, 80)
  );
  record("A2A discovery does not start scan", discoveryJson.scanStarted !== true);

  const unpaid = await fetch(`${BASE}/api/tools/analyze_repository`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repoUrl: "https://github.com/smokychain22/repodiet-e2e-test",
      branch: "main",
    }),
  });
  const unpaidJson = await unpaid.json();
  record("A2MCP unpaid returns 402", unpaid.status === 402, `status=${unpaid.status}`);
  record(
    "A2MCP quote is 0.03 USDT",
    unpaidJson.quote?.amount === "0.03" || unpaidJson.quote?.amountMicro === "30000",
    unpaidJson.quote?.priceLabel
  );
  record("A2MCP quote bound to operation", unpaidJson.quote?.operation === "analyze_repository");

  const readiness = await fetch(`${BASE}/api/okx/production-readiness`);
  let readinessJson: Record<string, unknown> = {};
  if (readiness.status === 404) {
    record(
      "production-readiness endpoint deployed",
      false,
      "404 — deploy cursor/production-grade-e2e-8b2b before PRODUCTION_READY"
    );
  } else {
    readinessJson = await readiness.json();
    record(
      "production-readiness responds",
      readiness.status === 200 || readiness.status === 503,
      `status=${readiness.status}`
    );
    record(
      "production-readiness not falsely ready without evidence",
      readinessJson.ready === true
        ? Boolean(
            (readinessJson.evidence as { lastRealPrUrl?: string } | undefined)?.lastRealPrUrl
          )
        : true,
      String(readinessJson.verdict)
    );
  }

  const support = await fetch(`${BASE}/api/okx/support`);
  const supportJson = await support.json();
  record("support matrix available", support.ok);
  record(
    "no universal language claim",
    supportJson.support?.claims?.universalLanguageSupport === false
  );

  const card = await fetch(`${BASE}/.well-known/agent-card.json`);
  record("agent card available", card.ok, `status=${card.status}`);

  const health = await fetch(`${BASE}/api/okx/health`);
  const healthJson = await health.json();
  record("okx health responds", health.ok);
  record("paid mode enabled on production", healthJson.a2mcpPaidMode === true);
  record("real x402 entitlement mode", healthJson.entitlementMode === "live_x402");

  // Explicitly mark unpaid canaries that still require owner action.
  record(
    "paid A2MCP canary (wallet signature)",
    false,
    "REQUIRES_OWNER: sign real 0.03 USDT x402 payment against bound quote"
  );
  record(
    "A2A escrow + GitHub PR canary",
    false,
    "REQUIRES_OWNER: fund escrow + GitHub App install on canary repo"
  );

  const failed = checks.filter((c) => !c.pass);
  const ownerBlocked = failed.filter((c) => c.detail?.startsWith("REQUIRES_OWNER"));
  const engineeringFailed = failed.filter((c) => !c.detail?.startsWith("REQUIRES_OWNER"));

  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  console.log(`Owner-blocked: ${ownerBlocked.length}; Engineering failures: ${engineeringFailed.length}`);

  if (engineeringFailed.length > 0) {
    console.error(
      "ENGINEERING FAIL:",
      engineeringFailed.map((f) => f.name).join(", ")
    );
    console.log("OVERALL: NOT_READY");
    process.exit(1);
  }

  if (ownerBlocked.length > 0) {
    console.log("OVERALL: CONTROLLED_BETA — owner wallet/GitHub authorization still required");
    process.exit(2);
  }

  console.log("OVERALL: PRODUCTION_READY");
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
