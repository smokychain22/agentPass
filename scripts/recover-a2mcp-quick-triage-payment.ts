#!/usr/bin/env tsx
/**
 * Recover the verified OKX incident Quick Triage payment without a second charge.
 *
 * Usage:
 *   REPODIET_PRODUCTION_URL=https://skillswap-virid-kappa.vercel.app \
 *   REPODIET_INTERNAL_DIAGNOSTIC_SECRET=... \
 *   npx tsx scripts/recover-a2mcp-quick-triage-payment.ts
 */
const BASE =
  process.env.REPODIET_PRODUCTION_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "https://skillswap-virid-kappa.vercel.app";

const SECRET = process.env.REPODIET_INTERNAL_DIAGNOSTIC_SECRET?.trim();
const INCIDENT = {
  quoteId: "quote_oQs2zW2cmt7o",
  paymentReference:
    "0x351daeb986fc656fd611aaf01226e297efe42cfc91be1082222b94702d5fa73f",
  requestDigest:
    "sha256:c8bce6d551fcf7d08a32a996b1828a13580bc7983112e38f2ec56ec5eb5bf3d6",
  repositoryUrl:
    process.env.REPODIET_RECOVERY_REPO_URL ||
    "https://github.com/velz-cmd/repodiet-e2e-test",
};

function pass(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  return ok;
}

async function main() {
  if (!SECRET) {
    console.error("FAIL: REPODIET_INTERNAL_DIAGNOSTIC_SECRET required");
    process.exit(1);
  }

  console.log(`Recovering incident A2MCP payment on ${BASE}`);
  console.log(`  quote: ${INCIDENT.quoteId}`);
  console.log(`  tx: ${INCIDENT.paymentReference}`);

  const started = Date.now();
  const res = await fetch(`${BASE}/api/internal/a2mcp/recover-incident-payment`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-repodiet-diagnostic-secret": SECRET,
    },
    body: JSON.stringify({
      quoteId: INCIDENT.quoteId,
      paymentReference: INCIDENT.paymentReference,
      requestDigest: INCIDENT.requestDigest,
      repositoryUrl: INCIDENT.repositoryUrl,
      branch: "main",
    }),
  });

  const json = (await res.json()) as Record<string, unknown>;
  const elapsed = Date.now() - started;

  pass("recovery HTTP 200", res.status === 200, `status=${res.status} elapsed=${elapsed}ms`);
  pass("no second payment challenge", res.status !== 402, `status=${res.status}`);
  pass("receipt present", Boolean((json.receipt as { receiptId?: string })?.receiptId));
  pass(
    "same transaction hash",
    String((json.receipt as { paymentReference?: string })?.paymentReference ?? "") ===
      INCIDENT.paymentReference ||
      String(json.paymentReference ?? "") === INCIDENT.paymentReference,
    JSON.stringify({
      receiptPayment: (json.receipt as { paymentReference?: string })?.paymentReference,
    })
  );

  if (res.status !== 200) {
    console.log(JSON.stringify(json, null, 2));
    process.exit(1);
  }

  const replay = await fetch(`${BASE}/api/a2mcp/quick-triage`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-repodiet-quote-id": INCIDENT.quoteId,
      "x-payment-reference": INCIDENT.paymentReference,
    },
    body: JSON.stringify({
      repositoryUrl: INCIDENT.repositoryUrl,
      branch: "main",
      maximumFindings: 5,
      quoteId: INCIDENT.quoteId,
      paymentReference: INCIDENT.paymentReference,
      operation: "analyze_repository",
    }),
  });
  const replayJson = (await replay.json()) as Record<string, unknown>;
  pass("replay without payment", replay.status === 200 && replay.status !== 402, `status=${replay.status}`);
  pass("idempotent replay flag", Boolean(replayJson.idempotentReplay || replayJson.alreadyProcessed));

  console.log("\nRecovery evidence:");
  console.log(
    JSON.stringify(
      {
        httpStatus: res.status,
        elapsedMs: elapsed,
        receiptId: (json.receipt as { receiptId?: string })?.receiptId,
        quoteId: INCIDENT.quoteId,
        paymentReference: INCIDENT.paymentReference,
        requestDigest: INCIDENT.requestDigest,
        replayStatus: replay.status,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
