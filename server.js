import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { loadDb, saveDb, id, now } from "./lib/store.js";
import { resolveRepoPath, runScan } from "./lib/scanner/analyze.js";
import {
  buildRegressionContract,
  regressionMarkdown,
  cursorPromptMd,
  reportMarkdown,
  generatePatch,
  beforeAfterDelta,
} from "./lib/scanner/artifacts.js";
import { x402Gate, priceFor, demoPayHeaders } from "./lib/x402.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 8788);

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

function db() {
  return loadDb();
}
function persist(fn) {
  const state = db();
  const out = fn(state);
  saveDb(state);
  return out;
}

function ok(res, data) {
  res.json({ ok: true, data });
}
function fail(res, err, code = 400) {
  res.status(code).json({ ok: false, error: err.message || String(err) });
}

// ── Catalog / health ────────────────────────────────────────────────────────

app.get("/api/health", (_req, res) => {
  ok(res, {
    service: "RepoDiet",
    tagline: "Cut AI code bloat before your app collapses",
    network: "eip155:196",
    category: "Software Utility",
    version: "1.0.0",
  });
});

app.get("/api/catalog", (_req, res) => {
  ok(res, {
    name: "RepoDiet",
    description:
      "OKX ASP 5283 — A2MCP Quick Triage (analyze_repository, 0.03 USD₮0 via x402) and A2A Verified Cleanup PR (create_cleanup_pr, negotiated / default 1 USD₮0 escrow).",
    a2mcp: {
      serviceId: "32948",
      operation: "analyze_repository",
      price: "0.03 USD₮0",
      settlement: "live x402 on X Layer",
      description: "Bounded repository triage returning up to five prioritized findings.",
    },
    a2a: {
      serviceId: "32947",
      operation: "create_cleanup_pr",
      price: "negotiated",
      defaultReference: "1 USD₮0",
      settlement: "task agreement, escrow, delivery, buyer acceptance and release",
      description: "Customized repository cleanup delivered as a review-ready GitHub pull request.",
    },
    pricing: {
      a2mcp_quick_triage: "0.03 USD₮0",
      a2a_verified_cleanup_pr: "negotiated (default 1 USD₮0)",
    },
    note: "Not all paid tasks use x402. A2MCP uses x402; A2A uses escrow.",
  });
});

app.get("/api/demo/payment-headers", (req, res) => {
  const tool = req.query.tool || "scan_repo_bloat";
  ok(res, { headers: demoPayHeaders(tool), amount: priceFor(tool) });
});

// ── Scans ───────────────────────────────────────────────────────────────────

app.post("/api/scans/create", (req, res) => {
  try {
    const scan = persist((state) => {
      const scanId = id("scan");
      const record = {
        id: scanId,
        repo_url: req.body?.repoUrl || null,
        branch: req.body?.branch || "main",
        framework: null,
        mode: req.body?.mode || "deep",
        demo: !!req.body?.demo,
        status: "pending",
        created_at: now(),
        local_path: null,
        summary: null,
        findings: [],
      };
      state.scans[scanId] = record;
      return record;
    });
    ok(res, { scan });
  } catch (e) {
    fail(res, e);
  }
});

app.post("/api/scans/run", async (req, res) => {
  try {
    const scanId = req.body?.scanId;
    const state = db();
    const scan = state.scans[scanId];
    if (!scan) return fail(res, new Error("Scan not found"), 404);

    const { localPath, source } = await resolveRepoPath({
      repoUrl: scan.repo_url,
      branch: scan.branch,
      demo: scan.demo,
    });

    scan.status = "running";
    scan.local_path = localPath;
    saveDb(state);

    const result = await runScan(localPath, scan.mode);

    const updated = persist((s) => {
      const sc = s.scans[scanId];
      sc.status = "complete";
      sc.framework = result.framework;
      sc.source = source;
      sc.summary = result.summary;
      sc.findings = result.findings;
      sc.fingerprint = result.fingerprint;
      sc.file_count = result.fileCount;
      sc.completed_at = now();
      return sc;
    });

    ok(res, { scan: updated, summary: result.summary });
  } catch (e) {
    persist((s) => {
      if (req.body?.scanId && s.scans[req.body.scanId]) {
        s.scans[req.body.scanId].status = "error";
        s.scans[req.body.scanId].error = e.message;
      }
    });
    fail(res, e, 500);
  }
});

app.post("/api/scans/demo", async (_req, res) => {
  try {
    const scanId = id("scan");
    const localPath = path.join(process.cwd(), "demo-repo");
    const result = await runScan(localPath, "deep");
    const scan = persist((state) => {
      const record = {
        id: scanId,
        repo_url: "demo://vibe-task-app",
        branch: "main",
        framework: result.framework,
        mode: "deep",
        demo: true,
        status: "complete",
        local_path: localPath,
        source: "demo",
        summary: result.summary,
        findings: result.findings,
        fingerprint: result.fingerprint,
        file_count: result.fileCount,
        created_at: now(),
        completed_at: now(),
      };
      state.scans[scanId] = record;
      return record;
    });
    ok(res, { scan, summary: result.summary });
  } catch (e) {
    fail(res, e, 500);
  }
});

app.get("/api/scans/:id", (req, res) => {
  const scan = db().scans[req.params.id];
  if (!scan) return fail(res, new Error("Not found"), 404);
  ok(res, { scan });
});

app.get("/api/scans/:id/findings", (req, res) => {
  const scan = db().scans[req.params.id];
  if (!scan) return fail(res, new Error("Not found"), 404);
  ok(res, {
    findings: scan.findings || [],
    summary: scan.summary,
    grouped: groupFindings(scan.findings || []),
  });
});

function groupFindings(findings) {
  return {
    ai_slop: findings.filter((f) => f.type === "ai_slop"),
    duplicate_clusters: findings.filter((f) => f.type === "duplicate_cluster"),
    dead_files: findings.filter((f) => f.type === "dead_file"),
    unused_dependencies: findings.filter((f) => f.type === "unused_dependency"),
    orphan_routes: findings.filter((f) => f.type === "orphan_route"),
    review: findings.filter((f) => f.action === "REVIEW_FIRST"),
  };
}

app.post("/api/scans/:id/generate-patch", async (req, res) => {
  try {
    const scan = db().scans[req.params.id];
    if (!scan) return fail(res, new Error("Not found"), 404);
    const root = scan.local_path || path.join(process.cwd(), "demo-repo");
    const contract = buildRegressionContract(root, scan.framework, scan.findings || []);
    const artifacts = {
      report_md: reportMarkdown(scan, scan.findings || []),
      patch_text: generatePatch(scan.findings || [], root),
      regression_md: regressionMarkdown(contract),
      cursor_prompt_md: cursorPromptMd(scan, scan.findings || [], contract),
      findings_json: JSON.stringify(scan.findings || [], null, 2),
      contract_json: JSON.stringify(contract, null, 2),
    };

    persist((state) => {
      state.artifacts[scan.id] = { ...artifacts, generated_at: now() };
      state.scans[scan.id].artifacts_ready = true;
    });

    ok(res, {
      scan_id: scan.id,
      safe_patch_available: (scan.findings || []).some((f) => f.action === "SAFE_DELETE"),
      artifacts: {
        report: "report.md",
        patch: "repodiet-cleanup.patch",
        regression: "regression-checklist.md",
        cursor_prompt: "cursor-fix-prompt.md",
        findings: "findings.json",
      },
      preview: {
        patch_lines: artifacts.patch_text.split("\n").length,
        regression_sections: contract.manual_qa.length,
      },
      bundle: artifacts,
    });
  } catch (e) {
    fail(res, e, 500);
  }
});

app.get("/api/scans/:id/download", (req, res) => {
  const art = db().artifacts[req.params.id];
  if (!art) return fail(res, new Error("Generate patch first"), 404);
  const type = req.query.type || "bundle";
  if (type === "patch") {
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Content-Disposition", "attachment; filename=repodiet-cleanup.patch");
    return res.send(art.patch_text);
  }
  if (type === "regression") {
    res.setHeader("Content-Type", "text/markdown");
    res.setHeader("Content-Disposition", "attachment; filename=regression-checklist.md");
    return res.send(art.regression_md);
  }
  if (type === "cursor") {
    res.setHeader("Content-Type", "text/markdown");
    res.setHeader("Content-Disposition", "attachment; filename=cursor-fix-prompt.md");
    return res.send(art.cursor_prompt_md);
  }
  res.json({
    report_md: art.report_md,
    patch_text: art.patch_text,
    regression_md: art.regression_md,
    cursor_prompt_md: art.cursor_prompt_md,
    findings_json: art.findings_json,
  });
});

app.get("/api/scans/:id/verify", (req, res) => {
  const scan = db().scans[req.params.id];
  const art = db().artifacts[req.params.id];
  if (!scan) return fail(res, new Error("Not found"), 404);
  const delta = beforeAfterDelta(
    scan.summary || {},
    { ...scan.summary, bloat_score: Math.max(0, (scan.summary?.bloat_score || 0) - 15) },
  );
  ok(res, {
    regression_contract: art ? JSON.parse(art.contract_json || "{}") : null,
    before_after: delta,
    build_command: "npm run build",
    delivery_block: buildOkxDelivery(scan),
  });
});

function buildOkxDelivery(scan) {
  return `RepoDiet delivery for ${scan.repo_url || "demo"}
Framework: ${scan.framework}
Bloat score: ${scan.summary?.bloat_score}/100
Findings: ${scan.findings?.length || 0}
Safe deletes: ${scan.summary?.safe_deletes || 0}
Patch bundle: ready
Regression checklist: included`;
}

// ── A2MCP tool endpoints ────────────────────────────────────────────────────

async function toolScan(req, res, filterType = null) {
  try {
    const demo = req.body?.demo !== false && !req.body?.repo_url;
    const localPath = demo
      ? path.join(process.cwd(), "demo-repo")
      : (await resolveRepoPath({ repoUrl: req.body?.repo_url, branch: req.body?.branch })).localPath;
    const result = await runScan(localPath, req.body?.mode || "quick");
    let findings = result.findings;
    if (filterType) findings = findings.filter((f) => f.type === filterType);
    ok(res, {
      repo: req.body?.repo_url || "demo://vibe-task-app",
      framework: result.framework,
      bloat_findings: result.summary,
      findings: filterType ? findings : result.findings,
      payment: req.repodietPayment || null,
    });
  } catch (e) {
    fail(res, e, 500);
  }
}

app.post("/api/tools/scan_repo_bloat", x402Gate("scan_repo_bloat"), (req, res) => toolScan(req, res));
app.post("/api/tools/detect_duplicate_code", x402Gate("detect_duplicate_code"), (req, res) =>
  toolScan(req, res, "duplicate_cluster"),
);
app.post("/api/tools/find_dead_files", x402Gate("find_dead_files"), (req, res) =>
  toolScan(req, res, "dead_file"),
);
app.post("/api/tools/find_unused_dependencies", x402Gate("find_unused_dependencies"), (req, res) =>
  toolScan(req, res, "unused_dependency"),
);

app.post("/api/tools/generate_cleanup_patch", x402Gate("generate_cleanup_patch"), async (req, res) => {
  try {
    const demo = !req.body?.repo_url;
    const localPath = demo
      ? path.join(process.cwd(), "demo-repo")
      : (await resolveRepoPath({ repoUrl: req.body?.repo_url, branch: req.body?.branch })).localPath;
    const result = await runScan(localPath, "quick");
    const patch = generatePatch(result.findings, localPath);
    ok(res, {
      patch,
      findings_count: result.findings.length,
      bloat_findings: result.summary,
      payment: req.repodietPayment,
    });
  } catch (e) {
    fail(res, e, 500);
  }
});

app.post("/api/tools/generate_regression_checklist", x402Gate("generate_regression_checklist"), async (req, res) => {
  const root = path.join(process.cwd(), "demo-repo");
  const result = await runScan(root, "quick");
  const contract = buildRegressionContract(root, result.framework, result.findings);
  ok(res, {
    regression_checklist: regressionMarkdown(contract),
    contract,
    payment: req.repodietPayment,
  });
});

app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

export default app;

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`RepoDiet → http://localhost:${PORT}`);
  });
}
