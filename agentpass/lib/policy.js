import { toMicro, fromMicro, startOfUtcDay, startOfUtcWeek, startOfUtcMonth } from "./money.js";

/**
 * Default OPC policy — conservative starter for a solo founder running agents.
 */
export function defaultPolicy(companyId) {
  return {
    companyId,
    version: 1,
    updatedAt: new Date().toISOString(),
    currency: "USDT",
    network: "eip155:196",
    limits: {
      perTransaction: "25.00",
      hourly: "100.00",
      daily: "250.00",
      weekly: "1000.00",
      monthly: "3000.00",
    },
    allowlist: {
      // Empty = allow any payTo (still subject to limits). Populate for production.
      payTo: [],
      asps: [],
      categories: ["research", "compute", "data", "design", "devops", "marketing", "legal", "other"],
    },
    denylist: {
      payTo: [],
      asps: [],
      categories: [],
    },
    requireApprovalAbove: "50.00",
    autoApproveCategories: ["research", "data", "compute"],
    notes: "Starter OPC policy. Tighten allowlists before funding agents.",
  };
}

function sumSpent(entries, sinceIso) {
  const since = sinceIso ? Date.parse(sinceIso) : 0;
  let total = 0n;
  for (const e of entries) {
    if (e.status !== "settled" && e.status !== "authorized") continue;
    if (Date.parse(e.createdAt) < since) continue;
    total += toMicro(e.amount);
  }
  return total;
}

function windowStart(kind) {
  const d = new Date();
  if (kind === "hourly") {
    d.setUTCMinutes(0, 0, 0);
    return d.toISOString();
  }
  if (kind === "daily") return startOfUtcDay(d).toISOString();
  if (kind === "weekly") return startOfUtcWeek(d).toISOString();
  if (kind === "monthly") return startOfUtcMonth(d).toISOString();
  return null;
}

/**
 * Evaluate whether a proposed agent payment is allowed.
 * Returns { allowed, decision, reasons[], remaining{}, requiresApproval }
 */
export function evaluatePayment(policy, ledgerEntries, request) {
  const reasons = [];
  const amount = toMicro(request.amount);
  if (amount <= 0n) {
    return {
      allowed: false,
      decision: "deny",
      reasons: ["Amount must be positive"],
      remaining: {},
      requiresApproval: false,
    };
  }

  const category = (request.category || "other").toLowerCase();
  const payTo = (request.payTo || "").toLowerCase();
  const aspId = (request.aspId || "").toLowerCase();
  const agentId = request.agentId || "unknown";

  if (policy.denylist?.categories?.map((c) => c.toLowerCase()).includes(category)) {
    reasons.push(`Category "${category}" is denied`);
  }
  if (payTo && policy.denylist?.payTo?.map((a) => a.toLowerCase()).includes(payTo)) {
    reasons.push(`payTo ${payTo} is denylisted`);
  }
  if (aspId && policy.denylist?.asps?.map((a) => a.toLowerCase()).includes(aspId)) {
    reasons.push(`ASP ${aspId} is denylisted`);
  }

  const allowedCats = policy.allowlist?.categories || [];
  if (allowedCats.length && !allowedCats.map((c) => c.toLowerCase()).includes(category)) {
    reasons.push(`Category "${category}" not in allowlist`);
  }
  const allowedPayTo = policy.allowlist?.payTo || [];
  if (allowedPayTo.length && payTo && !allowedPayTo.map((a) => a.toLowerCase()).includes(payTo)) {
    reasons.push(`payTo ${payTo} not in allowlist`);
  }
  const allowedAsps = policy.allowlist?.asps || [];
  if (allowedAsps.length && aspId && !allowedAsps.map((a) => a.toLowerCase()).includes(aspId)) {
    reasons.push(`ASP ${aspId} not in allowlist`);
  }

  const remaining = {};
  const limitChecks = [
    ["perTransaction", null],
    ["hourly", windowStart("hourly")],
    ["daily", windowStart("daily")],
    ["weekly", windowStart("weekly")],
    ["monthly", windowStart("monthly")],
  ];

  for (const [key, since] of limitChecks) {
    const cap = toMicro(policy.limits?.[key] ?? "0");
    if (cap <= 0n) continue;
    const spent =
      key === "perTransaction"
        ? 0n
        : sumSpent(
            ledgerEntries.filter((e) => !request.agentId || e.agentId === agentId || e.scope === "company"),
            since,
          );
    // Company-wide windows: sum all agents
    const companySpent =
      key === "perTransaction"
        ? 0n
        : sumSpent(ledgerEntries, since);
    const used = companySpent;
    const left = cap - used;
    remaining[key] = fromMicro(left < 0n ? 0n : left);
    if (key === "perTransaction") {
      if (amount > cap) reasons.push(`Exceeds per-transaction limit ${fromMicro(cap)}`);
    } else if (amount > left) {
      reasons.push(`Exceeds ${key} limit (remaining ${fromMicro(left < 0n ? 0n : left)})`);
    }
  }

  const approvalThreshold = toMicro(policy.requireApprovalAbove ?? "0");
  const autoCats = (policy.autoApproveCategories || []).map((c) => c.toLowerCase());
  let requiresApproval = approvalThreshold > 0n && amount >= approvalThreshold;
  if (requiresApproval && autoCats.includes(category) && amount < approvalThreshold * 2n) {
    // Soft auto-approve for trusted categories under 2x threshold
    requiresApproval = amount >= approvalThreshold * 2n;
  }

  if (reasons.length) {
    return {
      allowed: false,
      decision: "deny",
      reasons,
      remaining,
      requiresApproval: false,
    };
  }

  if (requiresApproval) {
    return {
      allowed: false,
      decision: "needs_approval",
      reasons: [`Amount ${fromMicro(amount)} requires founder approval (threshold ${fromMicro(approvalThreshold)})`],
      remaining,
      requiresApproval: true,
    };
  }

  return {
    allowed: true,
    decision: "allow",
    reasons: ["Within policy"],
    remaining,
    requiresApproval: false,
  };
}

export function summarizeBudget(policy, ledgerEntries) {
  const windows = {
    hourly: windowStart("hourly"),
    daily: windowStart("daily"),
    weekly: windowStart("weekly"),
    monthly: windowStart("monthly"),
  };
  const out = {};
  for (const [key, since] of Object.entries(windows)) {
    const cap = toMicro(policy.limits?.[key] ?? "0");
    const spent = sumSpent(ledgerEntries, since);
    out[key] = {
      limit: fromMicro(cap),
      spent: fromMicro(spent),
      remaining: fromMicro(cap - spent < 0n ? 0n : cap - spent),
      utilization: cap === 0n ? 0 : Number((spent * 10000n) / cap) / 100,
    };
  }
  out.perTransaction = {
    limit: fromMicro(toMicro(policy.limits?.perTransaction ?? "0")),
  };
  return out;
}
