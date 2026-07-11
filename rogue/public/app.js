// Rogue command-center client.
const $ = (sel) => document.querySelector(sel);
const runBtn = $("#runBtn");
const fixBtn = $("#fixBtn");
const resetBtn = $("#resetBtn");

let lastReport = null; // baseline (undefended) run
let recommendedFixes = [];

async function scan(guardrails) {
  const targetName = $("#targetName").value || "Untitled Agent";
  const res = await fetch("/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ guardrails, targetName }),
  });
  return res.json();
}

function sevChip(label, count, cls) {
  return `<span class="sev-chip"><b class="${cls}" style="padding:0">${count}</b> ${label}</span>`;
}

function renderScore(report, deltaText) {
  $("#scoreboard").classList.remove("hidden");
  const r = $("#readiness");
  r.textContent = report.readiness;
  r.style.color =
    report.readiness >= 90 ? "var(--accent)" : report.readiness >= 70 ? "var(--warn)" : "var(--crit)";
  $("#verdict").textContent = report.verdict;
  $("#sevRow").innerHTML = [
    sevChip("critical", report.bySeverity.critical, "sev-critical"),
    sevChip("high", report.bySeverity.high, "sev-high"),
    sevChip("medium", report.bySeverity.medium, "sev-medium"),
    `<span class="sev-chip"><b style="padding:0;color:var(--accent)">${report.blockedCount}</b> blocked</span>`,
  ].join("");
  const delta = $("#delta");
  if (deltaText) {
    delta.textContent = deltaText;
    delta.classList.remove("hidden");
  } else {
    delta.classList.add("hidden");
  }
}

function renderResults(report) {
  const wrap = $("#results");
  wrap.innerHTML = "";
  report.results.forEach((r) => {
    const card = document.createElement("div");
    card.className = `card ${r.exploited ? "exploited" : "blocked"}`;
    card.innerHTML = `
      <div class="card-top">
        <div>
          <div class="card-cat">${r.category}</div>
          <div class="card-name">${r.name}</div>
        </div>
        <div style="text-align:right">
          <div class="status ${r.status}">${r.status}</div>
          <div style="margin-top:6px"><span class="sev-tag sev-${r.severity}">${r.severity}</span></div>
        </div>
      </div>
      <div class="detail">
        <div class="row"><div class="lbl">Vector</div><div>${r.vector}</div></div>
        <div class="row"><div class="lbl">Attack sent</div><div class="mono attack">${escapeHtml(r.prompt)}</div></div>
        <div class="row"><div class="lbl">Agent response</div><div class="mono resp ${r.exploited ? "bad" : "good"}">${escapeHtml(
          r.response.text
        )}${r.response.actions.length ? "\n[actions: " + r.response.actions.join(", ") + "]" : ""}</div></div>
        <div class="row"><div class="lbl">Policy ${r.exploited ? "violated" : "upheld"}</div><div>${r.policy}</div></div>
        <div class="row"><div class="lbl">Guardrail fix</div><div class="fix">${r.guardrail}</div></div>
      </div>`;
    card.addEventListener("click", () => card.classList.toggle("open"));
    wrap.appendChild(card);
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

runBtn.addEventListener("click", async () => {
  runBtn.disabled = true;
  runBtn.textContent = "⏳ Attacking…";
  const report = await scan([]); // no guardrails = baseline
  lastReport = report;
  recommendedFixes = report.recommendedFixes;
  renderScore(report);
  renderResults(report);
  runBtn.textContent = "▶ Re-run baseline";
  runBtn.disabled = false;
  fixBtn.disabled = recommendedFixes.length === 0;
  resetBtn.disabled = false;
});

fixBtn.addEventListener("click", async () => {
  fixBtn.disabled = true;
  fixBtn.textContent = "⏳ Patching + retesting…";
  const before = lastReport ? lastReport.readiness : 0;
  const report = await scan(recommendedFixes); // apply all recommended guardrails
  renderScore(report, `Readiness ${before} → ${report.readiness}  (+${report.readiness - before})  after applying ${recommendedFixes.length} guardrails`);
  renderResults(report);
  fixBtn.textContent = "✓ Guardrails applied";
});

resetBtn.addEventListener("click", async () => {
  runBtn.disabled = false;
  runBtn.textContent = "▶ Launch Gauntlet";
  fixBtn.disabled = true;
  fixBtn.textContent = "🛡 Apply Guardrails & Retest";
  resetBtn.disabled = true;
  $("#scoreboard").classList.add("hidden");
  $("#results").innerHTML = "";
  lastReport = null;
});
