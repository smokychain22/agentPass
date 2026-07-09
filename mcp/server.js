#!/usr/bin/env node
/**
 * AgentPass MCP server — stdio JSON-RPC subset for Claude / Codex / OpenClaw / Hermes.
 * Tools map 1:1 to the HTTP ASP so agents can gate every x402 spend.
 *
 * Usage: node mcp/server.js
 * Env: AGENTPASS_URL=http://localhost:8787
 */

import { createInterface } from "node:readline";

const BASE = process.env.AGENTPASS_URL || "http://127.0.0.1:8787";

const TOOLS = [
  {
    name: "agentpass_create_company",
    description: "Create a one-person company (OPC) with default spend policy on AgentPass.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        founder: { type: "string" },
      },
    },
  },
  {
    name: "agentpass_register_agent",
    description: "Register an agent under an OPC so it can request spend authorizations.",
    inputSchema: {
      type: "object",
      properties: {
        companyId: { type: "string" },
        name: { type: "string" },
        role: { type: "string" },
        wallet: { type: "string" },
      },
      required: ["companyId", "name"],
    },
  },
  {
    name: "agentpass_authorize",
    description:
      "Request authorization before paying any ASP via x402. Returns allow | deny | needs_approval.",
    inputSchema: {
      type: "object",
      properties: {
        companyId: { type: "string" },
        agentId: { type: "string" },
        amount: { type: "string", description: "USDT amount, e.g. 2.50" },
        category: { type: "string" },
        aspId: { type: "string" },
        payTo: { type: "string" },
        memo: { type: "string" },
        resource: { type: "string" },
      },
      required: ["companyId", "amount"],
    },
  },
  {
    name: "agentpass_settle",
    description: "Mark an authorized spend as settled and write a receipt to the OPC ledger.",
    inputSchema: {
      type: "object",
      properties: {
        companyId: { type: "string" },
        authorizationId: { type: "string" },
        txHash: { type: "string" },
      },
      required: ["companyId", "authorizationId"],
    },
  },
  {
    name: "agentpass_approve",
    description: "Founder approves or denies a pending spend authorization.",
    inputSchema: {
      type: "object",
      properties: {
        companyId: { type: "string" },
        authorizationId: { type: "string" },
        approve: { type: "boolean" },
        note: { type: "string" },
      },
      required: ["companyId", "authorizationId"],
    },
  },
  {
    name: "agentpass_budget",
    description: "Get live budget utilization, pending approvals, and recent ledger for an OPC.",
    inputSchema: {
      type: "object",
      properties: { companyId: { type: "string" } },
      required: ["companyId"],
    },
  },
  {
    name: "agentpass_set_policy",
    description: "Update OPC spend limits, allowlists, denylists, or approval threshold.",
    inputSchema: {
      type: "object",
      properties: {
        companyId: { type: "string" },
        limits: { type: "object" },
        allowlist: { type: "object" },
        denylist: { type: "object" },
        requireApprovalAbove: { type: "string" },
      },
      required: ["companyId"],
    },
  },
  {
    name: "agentpass_export",
    description: "Export settled receipts as CSV text for accounting / tax.",
    inputSchema: {
      type: "object",
      properties: {
        companyId: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
      },
      required: ["companyId"],
    },
  },
];

async function paymentHeaders(route) {
  const res = await fetch(`${BASE}/api/demo/payment-headers?route=${encodeURIComponent(route)}`);
  const json = await res.json();
  return json.data?.headers || {};
}

async function http(method, path, body, payRoute) {
  const headers = { "Content-Type": "application/json" };
  if (payRoute) Object.assign(headers, await paymentHeaders(payRoute));
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (payRoute === "export" && res.ok && path.endsWith(".csv")) return text;
  const json = JSON.parse(text);
  if (!res.ok || json.ok === false) throw new Error(json.error || text);
  return json.data;
}

async function callTool(name, args = {}) {
  switch (name) {
    case "agentpass_create_company":
      return http("POST", "/api/company", args);
    case "agentpass_register_agent":
      return http("POST", `/api/company/${args.companyId}/agents`, args);
    case "agentpass_authorize":
      return http("POST", `/api/company/${args.companyId}/authorize`, args, "authorize");
    case "agentpass_settle":
      return http("POST", `/api/company/${args.companyId}/settle`, args, "settle");
    case "agentpass_approve":
      return http("POST", `/api/company/${args.companyId}/approve`, args);
    case "agentpass_budget":
      return http("GET", `/api/company/${args.companyId}/snapshot`, null, "snapshot");
    case "agentpass_set_policy":
      return http("POST", `/api/company/${args.companyId}/policy`, args);
    case "agentpass_export": {
      const q = new URLSearchParams();
      if (args.from) q.set("from", args.from);
      if (args.to) q.set("to", args.to);
      const qs = q.toString() ? `?${q}` : "";
      return http("GET", `/api/company/${args.companyId}/export.csv${qs}`, null, "export");
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function respondError(id, message) {
  process.stdout.write(
    JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message } }) + "\n",
  );
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on("line", async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = msg;
  try {
    if (method === "initialize") {
      return respond(id, {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "agentpass", version: "1.0.0" },
        capabilities: { tools: {} },
      });
    }
    if (method === "notifications/initialized") return;
    if (method === "tools/list") return respond(id, { tools: TOOLS });
    if (method === "tools/call") {
      const result = await callTool(params.name, params.arguments || {});
      return respond(id, {
        content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }],
      });
    }
    respondError(id, `Unsupported method: ${method}`);
  } catch (e) {
    respondError(id, e.message || String(e));
  }
});
