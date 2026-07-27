/**
 * OKX marketplace rejection remediation — the registered A2MCP service
 * endpoint must answer reachability probes.
 *
 * Agent 9636 was rejected with: "We were unable to reach your Agent's
 * service endpoint during testing." The registered endpoint
 * (/api/a2mcp/quick-triage) previously exported only POST, so a plain
 * GET/HEAD probe received Next.js's default 405 with no body —
 * indistinguishable from an undeployed service.
 *
 * These tests pin both halves of the contract: the probe must be
 * reachable (200), and it must never become a billable side door.
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
  console.log("a2mcp-endpoint-liveness");

  await test("GET on the registered endpoint returns 200, not 405", async () => {
    const res = await quickTriageGet();
    assert.equal(res.status, 200);
  });

  await test("HEAD on the registered endpoint returns 200, not 405", async () => {
    const res = await quickTriageHead();
    assert.equal(res.status, 200);
  });

  await test("the descriptor reports the canonical agent, service, and operation", async () => {
    const res = await quickTriageGet();
    const body = (await res.json()) as {
      ok?: boolean;
      status?: string;
      agentId?: string;
      serviceId?: string;
      operation?: string;
      serviceType?: string;
    };
    assert.equal(body.ok, true);
    assert.equal(body.status, "online");
    assert.equal(body.agentId, "9636");
    assert.equal(body.serviceId, "37347");
    assert.equal(body.operation, "analyze_repository");
    assert.equal(body.serviceType, "A2MCP");
  });

  await test("the descriptor advertises POST + x402 as the paid invocation path", async () => {
    const res = await quickTriageGet();
    const body = (await res.json()) as {
      invocation?: { method?: string; paymentProtocol?: string; requiredFields?: string[] };
      price?: { amountMicro?: string };
    };
    assert.equal(body.invocation?.method, "POST");
    assert.equal(body.invocation?.paymentProtocol, "x402");
    assert.deepEqual(body.invocation?.requiredFields, ["repositoryUrl"]);
    // Real registered price, never a hardcoded placeholder.
    assert.equal(body.price?.amountMicro, "30000");
  });

  await test("a liveness probe never issues a payment challenge", async () => {
    const res = await quickTriageGet();
    assert.notEqual(res.status, 402);
    const body = (await res.json()) as Record<string, unknown>;
    // The 402 path returns paymentRequired/quote — a probe must have neither.
    assert.equal(body.paymentRequired, undefined);
    assert.equal(body.quote, undefined);
  });

  await test("a liveness probe never leaks seller wallet or signer material", async () => {
    const res = await quickTriageGet();
    const raw = JSON.stringify(await res.json()).toLowerCase();
    assert.ok(!raw.includes("0xaa895234c3fc31c40018eef975db6ac79bf87f1a"), "seller wallet leaked");
    assert.ok(!raw.includes("privatekey"), "key material leaked");
    assert.ok(!raw.includes("0x00dbdbb36b71ace0e1fc517056f376f977d8256e"), "signer leaked");
  });

  await test("probes are not cached, so reachability always reflects live state", async () => {
    const get = await quickTriageGet();
    const head = await quickTriageHead();
    assert.equal(get.headers.get("cache-control"), "no-store");
    assert.equal(head.headers.get("cache-control"), "no-store");
  });

  console.log("a2mcp-endpoint-liveness: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
