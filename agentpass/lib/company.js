import { id, now } from "./store.js";
import { toMicro, fromMicro } from "./money.js";
import { evaluatePayment, summarizeBudget, defaultPolicy } from "./policy.js";

export function createCompany(db, { name, founder, network = "eip155:196" }) {
  const companyId = id("opc");
  const company = {
    id: companyId,
    name: name || "Untitled OPC",
    founder: founder || "founder",
    network,
    createdAt: now(),
    status: "active",
  };
  db.companies[companyId] = company;
  db.policies[companyId] = defaultPolicy(companyId);
  db.ledgers[companyId] = [];
  db.authorizations[companyId] = [];
  db.receipts[companyId] = [];
  db.agents[companyId] = {};
  return company;
}

export function registerAgent(db, companyId, { name, role = "worker", wallet = null }) {
  const company = db.companies[companyId];
  if (!company) throw new Error("Company not found");
  const agentId = id("agt");
  const agent = {
    id: agentId,
    companyId,
    name: name || "Agent",
    role,
    wallet,
    createdAt: now(),
    status: "active",
    stats: { authorized: 0, settled: 0, denied: 0, spentMicro: "0" },
  };
  db.agents[companyId][agentId] = agent;
  return agent;
}

export function getLedger(db, companyId) {
  return db.ledgers[companyId] || [];
}

export function authorizeSpend(db, companyId, payload) {
  const company = db.companies[companyId];
  if (!company) throw new Error("Company not found");
  const policy = db.policies[companyId];
  if (!policy) throw new Error("Policy not found");
  const ledger = getLedger(db, companyId);

  const request = {
    amount: payload.amount,
    category: payload.category || "other",
    payTo: payload.payTo || "",
    aspId: payload.aspId || "",
    agentId: payload.agentId || "",
    memo: payload.memo || "",
    resource: payload.resource || "",
  };

  if (request.agentId && !db.agents[companyId]?.[request.agentId]) {
    throw new Error("Agent not registered to this company");
  }

  const verdict = evaluatePayment(policy, ledger, request);
  const authId = id("auth");
  const entry = {
    id: authId,
    type: "authorization",
    companyId,
    agentId: request.agentId || null,
    amount: fromMicro(toMicro(request.amount)),
    amountMicro: toMicro(request.amount).toString(),
    category: request.category,
    payTo: request.payTo,
    aspId: request.aspId,
    memo: request.memo,
    resource: request.resource,
    decision: verdict.decision,
    reasons: verdict.reasons,
    remaining: verdict.remaining,
    status: verdict.decision === "allow" ? "authorized" : verdict.decision === "needs_approval" ? "pending_approval" : "denied",
    createdAt: now(),
    expiresAt: new Date(Date.now() + (payload.ttlSeconds || 300) * 1000).toISOString(),
    approvalToken: verdict.decision === "needs_approval" ? id("apr") : null,
  };

  db.authorizations[companyId].push(entry);
  ledger.push(entry);

  if (request.agentId && db.agents[companyId][request.agentId]) {
    const ag = db.agents[companyId][request.agentId];
    if (entry.status === "authorized") ag.stats.authorized += 1;
    if (entry.status === "denied") ag.stats.denied += 1;
  }

  return { authorization: entry, verdict };
}

export function approveAuthorization(db, companyId, authId, { approve = true, note = "" } = {}) {
  const list = db.authorizations[companyId] || [];
  const entry = list.find((a) => a.id === authId || a.approvalToken === authId);
  if (!entry) throw new Error("Authorization not found");
  if (entry.status !== "pending_approval") throw new Error(`Cannot approve status=${entry.status}`);

  if (approve) {
    entry.status = "authorized";
    entry.decision = "allow";
    entry.approvedAt = now();
    entry.approvalNote = note;
    entry.reasons = [...(entry.reasons || []), "Founder approved"];
  } else {
    entry.status = "denied";
    entry.decision = "deny";
    entry.approvedAt = now();
    entry.approvalNote = note;
    entry.reasons = [...(entry.reasons || []), "Founder rejected"];
  }

  // Mirror into ledger copy
  const ledger = getLedger(db, companyId);
  const le = ledger.find((e) => e.id === entry.id);
  if (le) Object.assign(le, entry);

  return entry;
}

export function settleAuthorization(db, companyId, authId, { txHash = null, receipt = {} } = {}) {
  const list = db.authorizations[companyId] || [];
  const entry = list.find((a) => a.id === authId);
  if (!entry) throw new Error("Authorization not found");
  if (entry.status !== "authorized") throw new Error(`Cannot settle status=${entry.status}`);
  if (Date.parse(entry.expiresAt) < Date.now()) {
    entry.status = "expired";
    throw new Error("Authorization expired");
  }

  entry.status = "settled";
  entry.settledAt = now();
  entry.txHash = txHash;

  const receiptId = id("rcpt");
  const rcpt = {
    id: receiptId,
    authorizationId: entry.id,
    companyId,
    agentId: entry.agentId,
    amount: entry.amount,
    category: entry.category,
    payTo: entry.payTo,
    aspId: entry.aspId,
    memo: entry.memo,
    resource: entry.resource,
    txHash,
    createdAt: now(),
    ...receipt,
  };
  db.receipts[companyId].push(rcpt);

  const ledger = getLedger(db, companyId);
  const le = ledger.find((e) => e.id === entry.id);
  if (le) Object.assign(le, entry);

  if (entry.agentId && db.agents[companyId]?.[entry.agentId]) {
    const ag = db.agents[companyId][entry.agentId];
    ag.stats.settled += 1;
    ag.stats.spentMicro = (BigInt(ag.stats.spentMicro || "0") + BigInt(entry.amountMicro)).toString();
  }

  return { authorization: entry, receipt: rcpt };
}

export function recordExternalSpend(db, companyId, payload) {
  // For imports / post-hoc logging of x402 spends that already happened
  const auth = authorizeSpend(db, companyId, { ...payload, amount: payload.amount });
  if (auth.authorization.status === "authorized") {
    return settleAuthorization(db, companyId, auth.authorization.id, {
      txHash: payload.txHash || null,
      receipt: { imported: true, note: payload.note || "external settle" },
    });
  }
  return auth;
}

export function getFinanceSnapshot(db, companyId) {
  const company = db.companies[companyId];
  if (!company) throw new Error("Company not found");
  const policy = db.policies[companyId];
  const ledger = getLedger(db, companyId);
  const budget = summarizeBudget(policy, ledger);
  const agents = Object.values(db.agents[companyId] || {});
  const receipts = db.receipts[companyId] || [];
  const pending = (db.authorizations[companyId] || []).filter((a) => a.status === "pending_approval");

  const byCategory = {};
  for (const r of receipts) {
    byCategory[r.category] = (byCategory[r.category] || 0) + Number(r.amount);
  }

  const settled = ledger.filter((e) => e.status === "settled");
  const denied = ledger.filter((e) => e.status === "denied");

  return {
    company,
    policy,
    budget,
    agents,
    pendingApprovals: pending,
    recentReceipts: receipts.slice(-20).reverse(),
    recentLedger: ledger.slice(-30).reverse(),
    stats: {
      settledCount: settled.length,
      deniedCount: denied.length,
      receiptCount: receipts.length,
      spendByCategory: byCategory,
      totalSettled: fromMicro(
        settled.reduce((acc, e) => acc + BigInt(e.amountMicro || "0"), 0n),
      ),
    },
  };
}

export function exportBooks(db, companyId, { from = null, to = null } = {}) {
  const receipts = (db.receipts[companyId] || []).filter((r) => {
    const t = Date.parse(r.createdAt);
    if (from && t < Date.parse(from)) return false;
    if (to && t > Date.parse(to)) return false;
    return true;
  });
  const lines = [
    "receipt_id,authorization_id,agent_id,amount,category,pay_to,asp_id,memo,resource,tx_hash,created_at",
  ];
  for (const r of receipts) {
    const row = [
      r.id,
      r.authorizationId,
      r.agentId || "",
      r.amount,
      r.category,
      r.payTo || "",
      r.aspId || "",
      csvEscape(r.memo || ""),
      csvEscape(r.resource || ""),
      r.txHash || "",
      r.createdAt,
    ];
    lines.push(row.join(","));
  }
  return lines.join("\n");
}

function csvEscape(s) {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function updatePolicy(db, companyId, patch) {
  const policy = db.policies[companyId];
  if (!policy) throw new Error("Policy not found");
  const next = {
    ...policy,
    ...patch,
    limits: { ...policy.limits, ...(patch.limits || {}) },
    allowlist: {
      ...policy.allowlist,
      ...(patch.allowlist || {}),
    },
    denylist: {
      ...policy.denylist,
      ...(patch.denylist || {}),
    },
    version: (policy.version || 1) + 1,
    updatedAt: now(),
    companyId,
  };
  db.policies[companyId] = next;
  return next;
}
