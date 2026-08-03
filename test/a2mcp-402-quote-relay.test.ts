/**
 * The official x402 402 quote must reach the counterparty with real values.
 *
 * Observed live against production on 2026-08-03: the official OKX Payment SDK
 * returns HTTP 402 with the quote base64-encoded in the `Payment-Required`
 * header and an EMPTY JSON body (`{}`). The bridge read the quote from the body,
 * so a reviewer asking Agent 9636 to analyse a repository received:
 *
 *   PAYMENT_REQUIRED service=analyze_repository(37347) amount=unknown
 *   asset=unknown network=unknown payTo=unknown quoteId=unknown
 *
 * — a quote with nothing in it, which reads as a broken service. The fixture
 * below is the ACTUAL header captured from production, not a hand-written one,
 * so this test fails if either the SDK contract or the relay drifts.
 */
import assert from "node:assert/strict";

import { dispatchAnalyzeRepository } from "../openclaw-plugins/repodiet-a2a-bridge/dispatch.js";
import { formatAnalysisDispatchResult } from "../openclaw-plugins/repodiet-a2a-bridge/logic.js";

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

/** Verbatim from `POST https://skillswap-virid-kappa.vercel.app/api/a2mcp/quick-triage`, 2026-08-03. */
const PRODUCTION_PAYMENT_REQUIRED =
  "eyJ4NDAyVmVyc2lvbiI6MiwiZXJyb3IiOiJQYXltZW50IHJlcXVpcmVkIiwicmVzb3VyY2UiOnsidXJsIjoiaHR0cHM6Ly9za2ls" +
  "bHN3YXAtdmlyaWQta2FwcGEudmVyY2VsLmFwcC9hcGkvYTJtY3AvcXVpY2stdHJpYWdlIiwiZGVzY3JpcHRpb24iOiJSZXBvRGll" +
  "dCBRdWljayBUcmlhZ2Ug4oCUIGV2aWRlbmNlLWJhY2tlZCByZXBvc2l0b3J5IGFuYWx5c2lzIiwibWltZVR5cGUiOiJhcHBsaWNh" +
  "dGlvbi9qc29uIn0sImFjY2VwdHMiOlt7InNjaGVtZSI6ImV4YWN0IiwibmV0d29yayI6ImVpcDE1NToxOTYiLCJhbW91bnQiOiIz" +
  "MDAwMCIsImFzc2V0IjoiMHg3NzlkZWQwYzllMTAyMjIyNWY4ZTA2MzBiMzVhOWI1NGJlNzEzNzM2IiwicGF5VG8iOiIweGFhODk1" +
  "MjM0YzNmYzMxYzQwMDE4ZWVmOTc1ZGI2YWM3OWJmODdmMWEiLCJtYXhUaW1lb3V0U2Vjb25kcyI6MzAwLCJleHRyYSI6eyJuYW1l" +
  "IjoiVVNE4oKuMCIsInZlcnNpb24iOiIxIn19XX0=";

/** A fetch that answers exactly as production did: header-borne quote, empty body. */
function officialSdkFetch(headers: Record<string, string>, body: unknown, status = 402) {
  return async () => ({
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  });
}

async function run() {
  console.log("a2mcp-402-quote-relay");

  await test("the real production 402 relays real amount, asset, network and payTo", async () => {
    const result = await dispatchAnalyzeRepository(
      { repositoryUrl: "https://github.com/velz-cmd/repodiet-e2e-test", branch: undefined },
      officialSdkFetch({ "payment-required": PRODUCTION_PAYMENT_REQUIRED }, {})
    );

    assert.equal(result.status, 402);
    assert.equal(result.paymentRequired?.x402Version, 2);

    const reply = formatAnalysisDispatchResult(result);
    // 30000 at 6 decimals is the registered 0.03 USD₮0 price.
    assert.match(reply, /amount=30000/);
    assert.match(reply, /asset=USD₮0/);
    assert.match(reply, /network=eip155:196/);
    assert.match(reply, /payTo=0xaa895234c3fc31c40018eef975db6ac79bf87f1a/);
    assert.match(reply, /scheme=exact/);
    assert.match(reply, /x402Version=2/);
    assert.match(reply, /service=analyze_repository\(37347\)/);

    // The whole point: nothing may come back as "unknown" against a real quote.
    assert.doesNotMatch(reply, /unknown/);
  });

  await test("an absent quoteId is omitted rather than reported as unknown", async () => {
    const result = await dispatchAnalyzeRepository(
      { repositoryUrl: "https://github.com/velz-cmd/repodiet-e2e-test", branch: undefined },
      officialSdkFetch({ "payment-required": PRODUCTION_PAYMENT_REQUIRED }, {})
    );
    // The official v2 envelope carries no quoteId. Inventing "quoteId=unknown"
    // told the counterparty nothing and looked like a fault.
    assert.doesNotMatch(formatAnalysisDispatchResult(result), /quoteId/);
  });

  await test("a body-inlined quote is still honoured when no header is present", async () => {
    const result = await dispatchAnalyzeRepository(
      { repositoryUrl: "https://github.com/velz-cmd/repodiet-e2e-test", branch: undefined },
      officialSdkFetch(
        {},
        {
          quoteId: "q-1",
          accepts: [
            { amount: "30000", network: "eip155:196", payTo: "0xabc", extra: { name: "USD₮0" } },
          ],
        }
      )
    );
    const reply = formatAnalysisDispatchResult(result);
    assert.match(reply, /amount=30000/);
    assert.match(reply, /quoteId=q-1/);
  });

  await test("a malformed header never yields a half-decoded quote", async () => {
    for (const header of ["not-base64!!", "", Buffer.from("[1,2,3]").toString("base64")]) {
      const result = await dispatchAnalyzeRepository(
        { repositoryUrl: "https://github.com/velz-cmd/repodiet-e2e-test", branch: undefined },
        officialSdkFetch({ "payment-required": header }, {})
      );
      assert.equal(result.paymentRequired, undefined, `must not decode: ${header}`);
      // Falls back to the body, which is empty — honest "unknown", not invented.
      assert.match(formatAnalysisDispatchResult(result), /PAYMENT_REQUIRED/);
    }
  });

  await test("a non-402 response is unaffected by the header path", async () => {
    const result = await dispatchAnalyzeRepository(
      { repositoryUrl: "https://github.com/velz-cmd/repodiet-e2e-test", branch: undefined },
      officialSdkFetch({}, { findings: [1, 2], scanId: "scan-1" }, 200)
    );
    const reply = formatAnalysisDispatchResult(result);
    assert.match(reply, /findingsReturned=2/);
    assert.match(reply, /scanId=scan-1/);
  });

  console.log("a2mcp-402-quote-relay: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
