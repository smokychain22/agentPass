/**
 * AgentPass smoke tests — policy engine + HTTP API.
 * Run: npm test  (server must not already hold the port; test boots its own)
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluatePayment, defaultPolicy } from "../lib/policy.js";
import { toMicro, fromMicro } from "../lib/money.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, "data-test");
const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${msg}`);
  }
}

// ── Unit: money + policy ────────────────────────────────────────────────────

console.log("\n[unit] money");
assert(fromMicro(toMicro("2.50")) === "2.5", "2.50 roundtrip");
assert(fromMicro(toMicro(1)) === "1", "integer roundtrip");
assert(toMicro("0.005") === 5000n, "micros for 0.005");

console.log("\n[unit] policy");
{
  const policy = defaultPolicy("opc_test");
  policy.limits = {
    perTransaction: "10.00",
    hourly: "50.00",
    daily: "50.00",
    weekly: "200.00",
    monthly: "500.00",
  };
  policy.requireApprovalAbove = "8.00";
  policy.autoApproveCategories = ["research"];

  const allow = evaluatePayment(policy, [], {
    amount: "3.00",
    category: "research",
    agentId: "a1",
  });
  assert(allow.decision === "allow", "small research spend allowed");

  const need = evaluatePayment(policy, [], {
    amount: "9.00",
    category: "other",
    agentId: "a1",
  });
  assert(need.decision === "needs_approval", "over threshold needs approval");

  const deny = evaluatePayment(policy, [], {
    amount: "60.00",
    category: "research",
    agentId: "a1",
  });
  assert(deny.decision === "deny", "over daily limit denied");

  const ledger = [
    {
      status: "settled",
      amount: "40.00",
      amountMicro: toMicro("40").toString(),
      createdAt: new Date().toISOString(),
      agentId: "a1",
    },
  ];
  const tight = evaluatePayment(policy, ledger, {
    amount: "15.00",
    category: "research",
    agentId: "a1",
  });
  assert(tight.decision === "deny", "remaining daily budget enforced");
}

// ── HTTP integration ────────────────────────────────────────────────────────

async function payHeaders(route) {
  const res = await fetch(`${BASE}/api/demo/payment-headers?route=${route}`);
  const json = await res.json();
  return json.data.headers;
}

async function main() {
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.mkdirSync(DATA, { recursive: true });

  const child = spawn("node", ["server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      AGENTPASS_DATA_DIR: DATA,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let boot = "";
  child.stdout.on("data", (d) => (boot += d.toString()));
  child.stderr.on("data", (d) => (boot += d.toString()));

  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) break;
    } catch {
      /* wait */
    }
    await sleep(100);
  }

  console.log("\n[http] health + catalog");
  {
    const h = await fetch(`${BASE}/api/health`).then((r) => r.json());
    assert(h.data.service === "AgentPass", "health service name");
    const c = await fetch(`${BASE}/api/catalog`).then((r) => r.json());
    assert(c.data.endpoints.length >= 6, "catalog has endpoints");
  }

  console.log("\n[http] demo seed + authorize flow");
  {
    const seed = await fetch(`${BASE}/api/demo/seed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }).then((r) => r.json());
    assert(seed.ok, "seed ok");
    const companyId = seed.data.company.id;
    const agentId = seed.data.agents[0].id;

    const headers = {
      "Content-Type": "application/json",
      ...(await payHeaders("authorize")),
    };
    const auth = await fetch(`${BASE}/api/company/${companyId}/authorize`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        agentId,
        amount: "1.25",
        category: "research",
        aspId: "test-asp",
        memo: "smoke",
      }),
    }).then((r) => r.json());
    assert(auth.data.authorization.status === "authorized", "authorize allows small spend");

    const settleHeaders = {
      "Content-Type": "application/json",
      ...(await payHeaders("settle")),
    };
    const settled = await fetch(`${BASE}/api/company/${companyId}/settle`, {
      method: "POST",
      headers: settleHeaders,
      body: JSON.stringify({
        authorizationId: auth.data.authorization.id,
        txHash: "0xsmoke",
      }),
    }).then((r) => r.json());
    assert(settled.data.receipt.id, "settle writes receipt");

    // 402 without payment
    const naked = await fetch(`${BASE}/api/company/${companyId}/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, amount: "1.00", category: "research" }),
    });
    assert(naked.status === 402, "authorize returns 402 without payment");
    const body402 = await naked.json();
    assert(body402.x402Version === 2, "402 body is x402 shaped");

    // Approve pending from seed
    const pendingId = seed.data.pending.id;
    const approved = await fetch(`${BASE}/api/company/${companyId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authorizationId: pendingId, approve: true }),
    }).then((r) => r.json());
    assert(approved.data.authorization.status === "authorized", "founder can approve");

    const snapHeaders = await payHeaders("snapshot");
    const snap = await fetch(`${BASE}/api/company/${companyId}/snapshot`, {
      headers: snapHeaders,
    }).then((r) => r.json());
    assert(Number(snap.data.stats.totalSettled) > 0, "snapshot shows settled spend");

    const exportHeaders = await payHeaders("export");
    const csv = await fetch(`${BASE}/api/company/${companyId}/export.csv`, {
      headers: exportHeaders,
    }).then((r) => r.text());
    assert(csv.includes("receipt_id"), "csv export has header");
  }

  child.kill("SIGTERM");
  fs.rmSync(DATA, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
