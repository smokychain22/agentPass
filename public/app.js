const state = { scanId: null, bundle: null };

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json();
  if (!res.ok || json.ok === false) throw new Error(json.error || res.statusText);
  return json.data;
}

function $(sel) {
  return document.querySelector(sel);
}
function $all(sel) {
  return [...document.querySelectorAll(sel)];
}

function switchTab(name) {
  $all(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  $all(".panel").forEach((p) => p.classList.toggle("active", p.dataset.panel === name));
}

$all(".tab").forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.tab)));

function badgeClass(action) {
  if (action === "SAFE_DELETE") return "safe";
  if (action === "DO_NOT_TOUCH") return "dnt";
  return "review";
}

function renderMetrics(summary) {
  const el = $("#scan-metrics");
  el.classList.remove("hidden");
  el.innerHTML = `
    <div class="metric"><div class="k">Bloat score</div><div class="v">${summary.bloat_score}</div></div>
    <div class="metric"><div class="k">Duplicates</div><div class="v">${summary.duplicate_clusters}</div></div>
    <div class="metric"><div class="k">Dead files</div><div class="v">${summary.unused_files}</div></div>
    <div class="metric"><div class="k">Unused deps</div><div class="v">${summary.unused_dependencies}</div></div>
    <div class="metric"><div class="k">Orphan routes</div><div class="v">${summary.orphan_routes}</div></div>
    <div class="metric"><div class="k">Safe deletes</div><div class="v">${summary.safe_deletes}</div></div>
  `;
  $("#term-preview").textContent = `$ repodiet scan complete

Framework: Next.js
Duplicate clusters: ${summary.duplicate_clusters}
Unused files: ${summary.unused_files}
Unused dependencies: ${summary.unused_dependencies}
Orphan routes: ${summary.orphan_routes}
Bloat score: ${summary.bloat_score}/100
Safe patch: ${summary.safe_deletes > 0 ? "ready" : "review needed"}`;
}

function renderFindings(findings, summary) {
  $("#findings-summary").innerHTML = `
    <span class="chip">AI slop: ${summary.ai_slop_hits}</span>
    <span class="chip">Duplicates: ${summary.duplicate_clusters}</span>
    <span class="chip">Dead files: ${summary.unused_files}</span>
    <span class="chip">Unused deps: ${summary.unused_dependencies}</span>
    <span class="chip">Review: ${summary.review_required}</span>
  `;
  const list = $("#findings-list");
  if (!findings.length) {
    list.innerHTML = "<p class='muted'>No findings.</p>";
    return;
  }
  list.innerHTML = findings
    .map(
      (f) => `<div class="finding">
      <span class="badge ${badgeClass(f.action)}">${f.action.replace(/_/g, " ")}</span>
      <div>
        <div class="path">${f.file_path}</div>
        <div class="reason">${f.reason}</div>
      </div>
      <span class="chip">${Math.round((f.confidence || 0) * 100)}%</span>
    </div>`,
    )
    .join("");
}

async function runDemo() {
  $("#scan-status").textContent = "Scanning demo repo…";
  const data = await api("/api/scans/demo", { method: "POST", body: {} });
  state.scanId = data.scan.id;
  $("#scan-status").textContent = `Complete · ${data.scan.id}`;
  renderMetrics(data.summary);
  renderFindings(data.scan.findings, data.summary);
  $("#btn-generate-patch").disabled = false;
  switchTab("findings");
}

async function runScan() {
  const repoUrl = $("#repo-url").value.trim();
  if (!repoUrl) return runDemo();
  $("#scan-status").textContent = "Creating scan…";
  const created = await api("/api/scans/create", {
    method: "POST",
    body: {
      repoUrl,
      branch: $("#repo-branch").value,
      mode: $("#scan-mode").value,
    },
  });
  state.scanId = created.scan.id;
  $("#scan-status").textContent = "Running analysis…";
  const ran = await api("/api/scans/run", { method: "POST", body: { scanId: state.scanId } });
  $("#scan-status").textContent = `Complete · ${state.scanId}`;
  renderMetrics(ran.summary);
  const full = await api(`/api/scans/${state.scanId}/findings`);
  renderFindings(full.findings, full.summary);
  $("#btn-generate-patch").disabled = false;
  switchTab("findings");
}

async function generatePatch() {
  if (!state.scanId) return;
  const data = await api(`/api/scans/${state.scanId}/generate-patch`, { method: "POST", body: {} });
  state.bundle = data.bundle;
  $("#patch-preview").textContent = data.bundle.patch_text.slice(0, 4000);
  $("#regression-preview").textContent = data.bundle.regression_md.slice(0, 3000);
  $("#btn-download-patch").disabled = false;
  $("#btn-copy-cursor").disabled = false;
  $("#btn-download-regression").disabled = false;
  $("#btn-export-okx").disabled = false;
  const verify = await api(`/api/scans/${state.scanId}/verify`);
  $("#delta-cards").innerHTML = Object.entries(verify.before_after)
    .map(
      ([k, v]) => `<div class="metric"><div class="k">${k}</div><div class="v">${v.before} → ${v.after}</div></div>`,
    )
    .join("");
  switchTab("patch");
}

async function download(type) {
  if (!state.scanId) return;
  window.open(`/api/scans/${state.scanId}/download?type=${type}`, "_blank");
}

async function copyCursor() {
  if (!state.bundle) return;
  await navigator.clipboard.writeText(state.bundle.cursor_prompt_md);
  $("#btn-copy-cursor").textContent = "Copied!";
  setTimeout(() => ($("#btn-copy-cursor").textContent = "Copy Cursor Prompt"), 1500);
}

async function exportOkx() {
  const verify = await api(`/api/scans/${state.scanId}/verify`);
  $("#okx-delivery").classList.remove("hidden");
  $("#okx-delivery").textContent = verify.delivery_block;
}

$("#btn-demo").addEventListener("click", () => runDemo().catch((e) => alert(e.message)));
$("#btn-scan-demo").addEventListener("click", () => runDemo().catch((e) => alert(e.message)));
$("#btn-hero-scan").addEventListener("click", () => {
  document.getElementById("demo").scrollIntoView({ behavior: "smooth" });
  runDemo().catch((e) => alert(e.message));
});
$("#btn-scan").addEventListener("click", () => runScan().catch((e) => alert(e.message)));
$("#btn-generate-patch").addEventListener("click", () => generatePatch().catch((e) => alert(e.message)));
$("#btn-download-patch").addEventListener("click", () => download("patch"));
$("#btn-download-regression").addEventListener("click", () => download("regression"));
$("#btn-copy-cursor").addEventListener("click", () => copyCursor().catch((e) => alert(e.message)));
$("#btn-export-okx").addEventListener("click", () => exportOkx().catch((e) => alert(e.message)));
