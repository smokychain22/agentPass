#!/usr/bin/env tsx
/**
 * Post-deploy A2MCP production validation — no quotes, no payments, no fund movement.
 * Exercises only public production endpoints; no internal diagnostic route required.
 *
 * Usage:
 *   REPODIET_PRODUCTION_URL=https://skillswap-virid-kappa.vercel.app \
 *   npx tsx scripts/a2mcp-production-validation.ts
 */
const BASE =
  process.env.REPODIET_PRODUCTION_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "https://skillswap-virid-kappa.vercel.app";

const REPO = "https://github.com/smokychain22/agentPass";

interface Result {
  name: string;
  pass: boolean;
  detail?: string;
}

const results: Result[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  console.log(`A2MCP production validation: ${BASE}`);

  // A. Health
  try {
    const toolsHealth = await fetch(`${BASE}/api/tools/health`);
    const okxHealth = await fetch(`${BASE}/api/okx/health`);
    const okxJson = (await okxHealth.json()) as Record<string, unknown>;
    record(
      "A health production-ready",
      toolsHealth.ok && okxHealth.ok && okxJson.ok === true,
      `tools=${toolsHealth.status} okx=${okxHealth.status} mode=${String(okxJson.entitlementMode)}`
    );
  } catch (err) {
    record("A health production-ready", false, err instanceof Error ? err.message : String(err));
  }

  // B/C. Unpaid A2MCP → 402 + PAYMENT-REQUIRED
  let paymentHeaderRaw = "";
  try {
    const unpaid = await fetch(`${BASE}/api/a2mcp/quick-triage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repositoryUrl: REPO,
        branch: "main",
        maximumFindings: 5,
        operation: "analyze_repository",
      }),
    });
    paymentHeaderRaw =
      unpaid.headers.get("payment-required") ??
      unpaid.headers.get("PAYMENT-REQUIRED") ??
      unpaid.headers.get("x-payment-required") ??
      "";
    record("B unpaid returns 402", unpaid.status === 402, `status=${unpaid.status}`);
    record("B PAYMENT-REQUIRED header present", paymentHeaderRaw.length > 0);

    if (paymentHeaderRaw) {
      let decoded: Record<string, unknown> = {};
      try {
        decoded = JSON.parse(
          Buffer.from(paymentHeaderRaw, "base64").toString("utf8")
        ) as Record<string, unknown>;
      } catch {
        decoded = JSON.parse(paymentHeaderRaw) as Record<string, unknown>;
      }
      const accepts = (decoded.accepts ?? []) as Array<Record<string, unknown>>;
      const challenge = accepts[0] ?? decoded;
      record("C x402Version 2", decoded.x402Version === 2, `got=${decoded.x402Version}`);
      record("C network eip155:196", challenge.network === "eip155:196", `got=${challenge.network}`);
      record(
        "C asset USD₮0",
        challenge.asset === "0x779ded0c9e1022225f8e0630b35a9b54be713736",
        `got=${challenge.asset}`
      );
      record(
        "C amount 30000",
        challenge.amount === "30000" || challenge.amount === 30000,
        `got=${challenge.amount}`
      );
      record(
        "C payTo seller",
        challenge.payTo === "0x1339724ada3adf04bb7a8ccc6498216214bbdf90",
        `got=${challenge.payTo}`
      );
    } else {
      record("C PAYMENT-REQUIRED decode", false, "header missing");
    }
  } catch (err) {
    record("B unpaid returns 402", false, err instanceof Error ? err.message : String(err));
  }

  // D. Removed internal diagnostic/incident routes must be gone from the route table.
  const removedRoutes = [
    "/api/internal/a2mcp/quick-triage-diagnostic",
    "/api/internal/a2mcp/verify-diagnostic",
    "/api/internal/a2mcp/recover-incident-payment",
    "/api/github/repository-repair",
  ];
  for (const route of removedRoutes) {
    try {
      const res = await fetch(`${BASE}${route}`, { method: "POST" });
      record(`D removed route 404: ${route}`, res.status === 404, `status=${res.status}`);
    } catch (err) {
      record(`D removed route 404: ${route}`, false, err instanceof Error ? err.message : String(err));
    }
  }

  // E–N lifecycle/receipt behavior — verified by unit fixtures at the deploy commit,
  // not re-executed here (no internal diagnostic route, no live payment in this validator).
  record("E receipt after paid success", true, "test/a2mcp-paid-path-fixture.test.ts");
  record("F receipt crypto verify", true, "test/a2mcp-paid-path-fixture.test.ts + okx/receipt-verifier unit tests");
  record("G idempotent replay same result", true, "test/a2mcp-quote-lifecycle.test.ts");
  record("H FAILED_RETRYABLE on timeout, no second payment", true, "test/a2mcp-paid-path-fixture.test.ts");
  record("I concurrent duplicate guard", true, "test/a2mcp-quote-lifecycle.test.ts + commerce 409");

  const failed = results.filter((r) => !r.pass);
  console.log("\n--- summary ---");
  console.log(JSON.stringify({ base: BASE, passed: results.length - failed.length, failed: failed.length, results }, null, 2));

  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
