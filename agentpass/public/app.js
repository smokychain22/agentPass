const state = {
  companyId: null,
  agents: [],
  snapshot: null,
};

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  // Attach demo x402 payment for paid routes
  if (opts.pay) {
    const route = opts.pay;
    const ph = await fetch(`/api/demo/payment-headers?route=${encodeURIComponent(route)}`).then((r) => r.json());
    Object.assign(headers, ph.data.headers);
  }
  const res = await fetch(path, {
    ...opts,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    if (!res.ok) throw new Error(text || res.statusText);
    return text;
  }
  if (res.status === 402) {
    const err = new Error("Payment required (x402)");
    err.payment = json;
    throw err;
  }
  if (!res.ok || json.ok === false) throw new Error(json.error || text || res.statusText);
  return json.data;
}

function $(sel) {
  return document.querySelector(sel);
}

function renderBudget(budget) {
  const el = $("#budget-cards");
  if (!budget) {
    el.innerHTML = `<p class="muted">Seed a demo to see live limits.</p>`;
    return;
  }
  const keys = ["daily", "weekly", "monthly", "hourly"];
  el.innerHTML = keys
    .map((k) => {
      const b = budget[k];
      const pct = Math.min(100, b.utilization || 0);
      return `<div class="bcard">
        <div class="k">${k}</div>
        <div class="v">$${b.remaining}</div>
        <div class="s">spent $${b.spent} / $${b.limit}</div>
        <div class="bar"><span style="width:${pct}%"></span></div>
      </div>`;
    })
    .join("");
}

function renderAgents(agents) {
  state.agents = agents || [];
  const sel = $("#agent-select");
  sel.innerHTML = state.agents
    .map((a) => `<option value="${a.id}">${a.name} (${a.role})</option>`)
    .join("");
  const list = $("#agent-list");
  if (!state.agents.length) {
    list.innerHTML = `<p class="muted">—</p>`;
    return;
  }
  list.innerHTML = state.agents
    .map((a) => {
      const spent = (Number(a.stats?.spentMicro || 0) / 1e6).toFixed(2);
      return `<div class="row">
        <div>
          <div>${a.name}</div>
          <div class="meta">${a.role} · ${a.id.slice(0, 12)}…</div>
        </div>
        <div class="amt">$${spent}<div class="meta">${a.stats?.settled || 0} settled · ${a.stats?.denied || 0} denied</div></div>
      </div>`;
    })
    .join("");
}

function renderPending(pending) {
  const el = $("#pending-list");
  if (!pending?.length) {
    el.innerHTML = `<p class="muted">None yet.</p>`;
    return;
  }
  el.innerHTML = pending
    .map(
      (p) => `<div class="row">
      <div>
        <div>$${p.amount} · ${p.category}</div>
        <div class="meta">${p.memo || p.aspId || p.id}</div>
      </div>
      <div>
        <button type="button" class="btn primary" data-approve="${p.id}">Approve</button>
        <button type="button" class="btn ghost" data-deny="${p.id}">Deny</button>
      </div>
    </div>`,
    )
    .join("");

  el.querySelectorAll("[data-approve]").forEach((btn) => {
    btn.addEventListener("click", () => decide(btn.dataset.approve, true));
  });
  el.querySelectorAll("[data-deny]").forEach((btn) => {
    btn.addEventListener("click", () => decide(btn.dataset.deny, false));
  });
}

function renderLedger(entries) {
  const el = $("#ledger-list");
  if (!entries?.length) {
    el.innerHTML = `<p class="muted">Empty.</p>`;
    return;
  }
  el.innerHTML = entries
    .map(
      (e) => `<div class="row">
      <div>
        <span class="badge ${e.status}">${e.status}</span>
        <span style="margin-left:0.4rem">${e.category}</span>
        <div class="meta">${e.memo || e.reasons?.[0] || e.id}</div>
      </div>
      <div class="amt">$${e.amount}</div>
    </div>`,
    )
    .join("");
}

function renderPills(snap) {
  const el = $("#status-pills");
  if (!snap) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = `
    <span class="pill ok">${snap.stats.settledCount} settled</span>
    <span class="pill warn">${snap.pendingApprovals.length} pending</span>
    <span class="pill danger">${snap.stats.deniedCount} denied</span>
    <span class="pill">total $${snap.stats.totalSettled}</span>
  `;
}

async function refresh() {
  if (!state.companyId) return;
  const snap = await api(`/api/company/${state.companyId}/snapshot`, { pay: "snapshot" });
  state.snapshot = snap;
  $("#company-label").textContent = `${snap.company.name} · ${snap.company.id}`;
  renderBudget(snap.budget);
  renderAgents(snap.agents);
  renderPending(snap.pendingApprovals);
  renderLedger(snap.recentLedger);
  renderPills(snap);
}

async function seed() {
  const btn = $("#btn-seed");
  btn.disabled = true;
  btn.textContent = "Spinning up…";
  try {
    const data = await api("/api/demo/seed", { method: "POST", body: {} });
    state.companyId = data.company.id;
    await refresh();
    document.getElementById("live").scrollIntoView({ behavior: "smooth" });
  } catch (e) {
    alert(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Launch demo OPC";
  }
}

async function authorize(ev) {
  ev.preventDefault();
  if (!state.companyId) {
    alert("Launch the demo OPC first.");
    return;
  }
  const out = $("#auth-out");
  try {
    const data = await api(`/api/company/${state.companyId}/authorize`, {
      method: "POST",
      pay: "authorize",
      body: {
        agentId: $("#agent-select").value,
        amount: $("#amount").value,
        category: $("#category").value,
        aspId: $("#asp-id").value,
        memo: $("#memo").value,
        payTo: "0x3333333333333333333333333333333333333333",
      },
    });
    out.hidden = false;
    out.textContent = JSON.stringify(
      {
        decision: data.authorization.decision,
        status: data.authorization.status,
        reasons: data.authorization.reasons,
        remaining: data.authorization.remaining,
        id: data.authorization.id,
      },
      null,
      2,
    );
    // Auto-settle allows
    if (data.authorization.status === "authorized") {
      await api(`/api/company/${state.companyId}/settle`, {
        method: "POST",
        pay: "settle",
        body: {
          authorizationId: data.authorization.id,
          txHash: `0xdemo_${Date.now().toString(16)}`,
        },
      });
    }
    await refresh();
  } catch (e) {
    out.hidden = false;
    out.textContent = e.payment ? JSON.stringify(e.payment, null, 2) : e.message;
  }
}

async function decide(authorizationId, approve) {
  await api(`/api/company/${state.companyId}/approve`, {
    method: "POST",
    body: { authorizationId, approve },
  });
  if (approve) {
    await api(`/api/company/${state.companyId}/settle`, {
      method: "POST",
      pay: "settle",
      body: { authorizationId, txHash: `0xapproved_${Date.now().toString(16)}` },
    });
  }
  await refresh();
}

async function downloadCsv() {
  if (!state.companyId) return;
  const ph = await fetch(`/api/demo/payment-headers?route=export`).then((r) => r.json());
  const res = await fetch(`/api/company/${state.companyId}/export.csv`, {
    headers: ph.data.headers,
  });
  if (res.status === 402) {
    alert("Payment required for export");
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `agentpass-${state.companyId}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

$("#btn-seed").addEventListener("click", seed);
$("#auth-form").addEventListener("submit", authorize);
$("#btn-export").addEventListener("click", downloadCsv);
$("#btn-refresh").addEventListener("click", () => refresh().catch((e) => alert(e.message)));
