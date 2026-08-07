/**
 * Discovery-probe contract for the registered A2MCP endpoint (service 37347).
 *
 * === Why this file was rewritten ===
 *
 * It previously pinned the OPPOSITE contract: GET/HEAD must return 200 with a
 * "liveness descriptor". Its own header conceded that was speculative — "NOT a
 * proven remediation for any specific review failure … no evidence a reviewer
 * probe required GET or HEAD".
 *
 * Evidence arrived on 2026-08-07. `onchainos agent x402-check --endpoint <url>`
 * is OKX's own endpoint validator, and run without `--body` it probes with GET.
 * Against live production it returned:
 *
 *   {"reason":"Endpoint returned HTTP 200 (not 402); not a valid x402
 *     service.","statusCode":200,"valid":false}
 *
 * while the same command WITH `--body` returned `valid:true`,
 * `amountHuman:0.03`, `network:eip155:196`. The paid path was correct
 * throughout; the 200 descriptor was the sole reason OKX's own tooling
 * classified this endpoint as not an x402 service at all.
 *
 * So the probe now answers 402 with the SDK's own PAYMENT-REQUIRED challenge.
 * The two properties the old file genuinely protected are kept and tightened:
 * a probe must never become a billable side door, and must never leak signer
 * or key material. What changed is only the status it must return — and it may
 * never again be 200, which is what this file now pins.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "repodiet-a2mcp-liveness-"));
process.env.REPODIET_DATA_DIR = dataDir;

import {
  GET as quickTriageGet,
  HEAD as quickTriageHead,
} from "../src/app/api/a2mcp/quick-triage/route";
import { isOfficialBoundaryConfigured } from "../src/lib/payment/okx-official-x402";

const PROBE_URL = "https://skillswap-virid-kappa.vercel.app/api/a2mcp/quick-triage";
const probeRequest = () => new Request(PROBE_URL, { method: "GET" });

/**
 * Without OKX Developer Portal credentials the SDK cannot mint a challenge, and
 * the route fails CLOSED with 503 rather than inventing one. Both outcomes are
 * correct; a 200 is correct under neither, which is the invariant that matters
 * and is asserted unconditionally below.
 */
const configured = isOfficialBoundaryConfigured();
const EXPECTED_STATUS = configured ? 402 : 503;

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`  ✓ ${name}`))
    .catch((err) => {
      console.error(`  ✗ ${name}`);
      throw err;
    });
}

async function run() {
  console.log(`a2mcp-endpoint-liveness (official boundary ${configured ? "configured" : "not configured"})`);

  await test("GET is never 405 and never 200 — a 200 is exactly what OKX's x402-check rejects", async () => {
    const res = await quickTriageGet(probeRequest());
    assert.notEqual(res.status, 405, "the route must answer GET at all");
    assert.notEqual(
      res.status,
      200,
      "a 200 makes `onchainos agent x402-check` report 'not a valid x402 service'"
    );
    assert.equal(res.status, EXPECTED_STATUS);
  });

  await test("HEAD returns the same status as GET, so a probe cannot get two different answers", async () => {
    const res = await quickTriageHead(probeRequest());
    assert.notEqual(res.status, 405);
    assert.notEqual(res.status, 200);
    assert.equal(res.status, EXPECTED_STATUS);
  });

  if (configured) {
    await test("the probe carries the SDK's PAYMENT-REQUIRED challenge, quoting the registered terms", async () => {
      const res = await quickTriageGet(probeRequest());
      const header = res.headers.get("payment-required");
      assert.ok(header, "the x402 challenge header must be present on the probe");
      const decoded = JSON.parse(Buffer.from(header!, "base64").toString("utf8")) as {
        x402Version?: number;
        accepts?: Array<{ scheme?: string; network?: string; amount?: string; payTo?: string }>;
      };
      assert.equal(decoded.x402Version, 2);
      const accept = decoded.accepts?.[0];
      assert.equal(accept?.scheme, "exact");
      assert.equal(accept?.network, "eip155:196", "must remain X Layer");
      assert.equal(accept?.amount, "30000", "must remain the registered 0.03 USD₮0");
      assert.equal(
        accept?.payTo?.toLowerCase(),
        "0xaa895234c3fc31c40018eef975db6ac79bf87f1a",
        "must remain the registered seller wallet"
      );
    });

    await test("HEAD carries the challenge headers but no body", async () => {
      const res = await quickTriageHead(probeRequest());
      assert.ok(res.headers.get("payment-required"), "HEAD must still carry the challenge header");
      assert.equal(await res.text(), "", "HEAD must not return a body");
    });
  } else {
    await test("without credentials the probe fails CLOSED and says so, rather than claiming to be online", async () => {
      const res = await quickTriageGet(probeRequest());
      const body = (await res.json()) as { error?: { code?: string } };
      assert.equal(res.status, 503);
      assert.equal(body.error?.code, "PAYMENT_BOUNDARY_UNAVAILABLE");
    });
  }

  await test("a probe is never billable: no scan result, no findings, no receipt, no settlement", async () => {
    const res = await quickTriageGet(probeRequest());
    const raw = await res.text();
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    // `result` is deliberately not in this list: the fail-closed 503 envelope
    // carries an empty `result: {}` by construction. What must never appear is
    // evidence that a scan actually ran or that revenue was recorded.
    for (const billable of ["findings", "scanId", "receiptId"]) {
      assert.equal(body[billable], undefined, `a probe must never return ${billable}`);
    }
    assert.deepEqual(
      body.result ?? {},
      {},
      "a probe's result envelope must be empty — nothing was executed"
    );
    assert.equal(
      res.headers.get("payment-response"),
      null,
      "a probe must never settle a payment"
    );
  });

  await test("a probe never leaks signer or key material", async () => {
    const res = await quickTriageGet(probeRequest());
    const raw = (await res.text()).toLowerCase();
    const headers = JSON.stringify([...res.headers]).toLowerCase();
    for (const haystack of [raw, headers]) {
      assert.ok(!haystack.includes("privatekey"), "key material leaked");
      assert.ok(
        !haystack.includes("0x00dbdbb36b71ace0e1fc517056f376f977d8256e"),
        "communication signer leaked"
      );
    }
    // The payee address is deliberately NOT treated as a leak: it is the
    // `payTo` of a payment challenge, is public by construction, and is
    // already published in the POST 402 and in the OKX service listing.
  });

  await test("probes are not cached, so reachability always reflects live state", async () => {
    const get = await quickTriageGet(probeRequest());
    const head = await quickTriageHead(probeRequest());
    assert.equal(get.headers.get("cache-control"), "no-store");
    assert.equal(head.headers.get("cache-control"), "no-store");
  });

  console.log("a2mcp-endpoint-liveness: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
