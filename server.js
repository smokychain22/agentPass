import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDb, saveDb } from "./lib/store.js";
import {
  createCompany,
  registerAgent,
  authorizeSpend,
  approveAuthorization,
  settleAuthorization,
  getFinanceSnapshot,
  exportBooks,
  updatePolicy,
} from "./lib/company.js";
import { x402Gate, priceFor, mintDemoPaymentHeader } from "./lib/x402.js";
import { fromMicro } from "./lib/money.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 8787);

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function db() {
  return loadDb();
}

function persist(mutator) {
  const state = db();
  const result = mutator(state);
  saveDb(state);
  return result;
}

function ok(res, data) {
  res.json({ ok: true, data });
}

function fail(res, err, code = 400) {
  res.status(code).json({ ok: false, error: err.message || String(err) });
}

// ── Health / catalog (for OKX.AI ASP listing) ───────────────────────────────

app.get("/api/health", (_req, res) => {
  ok(res, {
    service: "AgentPass",
    version: "1.0.0",
    network: "eip155:196",
    role: "ASP",
    categories: ["Finance Copilot", "Software Utility", "Revenue Rocket"],
    tagline: "OPC spend passport — policy, authorize, settle, books",
  });
});

app.get("/api/catalog", (_req, res) => {
  ok(res, {
    name: "AgentPass",
    description:
      "The finance control plane for one-person companies on OKX.AI. Set spend policy, authorize every agent payment before it signs, settle with receipts, and export books. Built for x402 / Agentic Wallet on X Layer.",
    endpoints: [
      { method: "POST", path: "/api/company", price: priceFor("create_company"), desc: "Create OPC" },
      { method: "POST", path: "/api/company/:id/agents", price: priceFor("register_agent"), desc: "Register agent" },
      { method: "POST", path: "/api/company/:id/authorize", price: priceFor("authorize"), desc: "Authorize spend" },
      { method: "POST", path: "/api/company/:id/settle", price: priceFor("settle"), desc: "Settle authorization" },
      { method: "GET", path: "/api/company/:id/snapshot", price: priceFor("snapshot"), desc: "Finance snapshot" },
      { method: "GET", path: "/api/company/:id/export.csv", price: priceFor("export"), desc: "Export books CSV" },
      { method: "POST", path: "/api/company/:id/policy", price: "0", desc: "Update policy" },
      { method: "POST", path: "/api/company/:id/approve", price: "0", desc: "Approve pending spend" },
    ],
    mcp: {
      tools: [
        "agentpass_create_company",
        "agentpass_register_agent",
        "agentpass_authorize",
        "agentpass_settle",
        "agentpass_budget",
        "agentpass_export",
        "agentpass_approve",
        "agentpass_set_policy",
      ],
    },
    pricing: "Pay-per-call via x402 on X Layer (USDT0 / USDG). Free OPC onboarding.",
  });
});

// ── Company lifecycle ───────────────────────────────────────────────────────

app.post("/api/company", (req, res) => {
  try {
    const company = persist((state) =>
      createCompany(state, {
        name: req.body?.name,
        founder: req.body?.founder,
        network: req.body?.network,
      }),
    );
    ok(res, { company, policy: db().policies[company.id] });
  } catch (e) {
    fail(res, e);
  }
});

app.get("/api/company/:id", (req, res) => {
  try {
    const state = db();
    const company = state.companies[req.params.id];
    if (!company) return fail(res, new Error("Company not found"), 404);
    ok(res, {
      company,
      policy: state.policies[company.id],
      agents: Object.values(state.agents[company.id] || {}),
    });
  } catch (e) {
    fail(res, e);
  }
});

app.post("/api/company/:id/agents", (req, res) => {
  try {
    const agent = persist((state) =>
      registerAgent(state, req.params.id, {
        name: req.body?.name,
        role: req.body?.role,
        wallet: req.body?.wallet,
      }),
    );
    ok(res, { agent });
  } catch (e) {
    fail(res, e);
  }
});

app.post("/api/company/:id/policy", (req, res) => {
  try {
    const policy = persist((state) => updatePolicy(state, req.params.id, req.body || {}));
    ok(res, { policy });
  } catch (e) {
    fail(res, e);
  }
});

// ── Paid: authorize / settle / snapshot / export ────────────────────────────

app.post("/api/company/:id/authorize", x402Gate("authorize"), (req, res) => {
  try {
    const result = persist((state) => authorizeSpend(state, req.params.id, req.body || {}));
    ok(res, { ...result, payment: req.agentPassPayment || null });
  } catch (e) {
    fail(res, e);
  }
});

app.post("/api/company/:id/approve", (req, res) => {
  try {
    const entry = persist((state) =>
      approveAuthorization(state, req.params.id, req.body?.authorizationId || req.body?.token, {
        approve: req.body?.approve !== false,
        note: req.body?.note || "",
      }),
    );
    ok(res, { authorization: entry });
  } catch (e) {
    fail(res, e);
  }
});

app.post("/api/company/:id/settle", x402Gate("settle"), (req, res) => {
  try {
    const result = persist((state) =>
      settleAuthorization(state, req.params.id, req.body?.authorizationId, {
        txHash: req.body?.txHash || null,
        receipt: req.body?.receipt || {},
      }),
    );
    ok(res, { ...result, payment: req.agentPassPayment || null });
  } catch (e) {
    fail(res, e);
  }
});

app.get("/api/company/:id/snapshot", x402Gate("snapshot"), (req, res) => {
  try {
    const snap = getFinanceSnapshot(db(), req.params.id);
    ok(res, { ...snap, payment: req.agentPassPayment || null });
  } catch (e) {
    fail(res, e);
  }
});

app.get("/api/company/:id/export.csv", x402Gate("export"), (req, res) => {
  try {
    const csv = exportBooks(db(), req.params.id, {
      from: req.query.from,
      to: req.query.to,
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="agentpass-${req.params.id}.csv"`);
    res.send(csv);
  } catch (e) {
    fail(res, e);
  }
});

// Demo helper: returns headers a client can attach for local x402 simulation
app.get("/api/demo/payment-headers", (req, res) => {
  const route = req.query.route || "authorize";
  ok(res, { headers: mintDemoPaymentHeader(priceFor(route)), amount: priceFor(route) });
});

// Seed demo OPC for the landing page
app.post("/api/demo/seed", (req, res) => {
  try {
    const out = persist((state) => {
      const company = createCompany(state, {
        name: req.body?.name || "Northstar OPC",
        founder: req.body?.founder || "you",
      });
      updatePolicy(state, company.id, {
        limits: {
          perTransaction: "100.00",
          hourly: "80.00",
          daily: "120.00",
          weekly: "500.00",
          monthly: "1500.00",
        },
        requireApprovalAbove: "20.00",
        allowlist: {
          categories: ["research", "compute", "data", "design", "devops", "marketing", "other"],
          payTo: [],
          asps: [],
        },
      });
      const researcher = registerAgent(state, company.id, {
        name: "Research Scout",
        role: "research",
      });
      const trader = registerAgent(state, company.id, {
        name: "Yield Runner",
        role: "defi",
      });
      const a1 = authorizeSpend(state, company.id, {
        agentId: researcher.id,
        amount: "2.50",
        category: "research",
        aspId: "newsliquid",
        payTo: "0x1111111111111111111111111111111111111111",
        memo: "Market brief for Q3",
        resource: "https://asp.example/research",
      });
      settleAuthorization(state, company.id, a1.authorization.id, {
        txHash: "0xdemo_settled_research_001",
      });
      // $40 is under per-tx/daily caps but over approval threshold → pending
      const a2 = authorizeSpend(state, company.id, {
        agentId: trader.id,
        amount: "40.00",
        category: "other",
        aspId: "otto-x",
        payTo: "0x2222222222222222222222222222222222222222",
        memo: "Large swap — should need approval",
        resource: "https://asp.example/swap",
      });
      // $200 blows past daily $120 → deny
      authorizeSpend(state, company.id, {
        agentId: trader.id,
        amount: "200.00",
        category: "other",
        aspId: "unknown-asp",
        memo: "Way over daily — should deny",
      });
      return {
        company,
        agents: [researcher, trader],
        pending: a2.authorization,
        snapshot: getFinanceSnapshot(state, company.id),
      };
    });
    ok(res, out);
  } catch (e) {
    fail(res, e);
  }
});

app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`AgentPass listening on http://localhost:${PORT}`);
  console.log(`Catalog: http://localhost:${PORT}/api/catalog`);
});
