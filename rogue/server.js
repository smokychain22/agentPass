// Rogue — zero-dependency HTTP server.
// Serves the command-center UI and the attack API. No external packages so it
// runs anywhere Node 18+ is available (no install/network needed).

const http = require("http");
const fs = require("fs");
const path = require("path");
const { runGauntlet, ALL_GUARDRAILS } = require("./engine/runner");

const PORT = process.env.PORT || 4177;
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function serveStatic(res, urlPath) {
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const filePath = path.join(PUBLIC_DIR, rel);
  // Prevent path traversal.
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not found");
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const { method } = req;
  const url = req.url.split("?")[0];

  if (method === "GET" && url === "/api/guardrails") {
    return sendJson(res, 200, { guardrails: ALL_GUARDRAILS });
  }

  if (method === "GET" && url === "/api/health") {
    return sendJson(res, 200, { ok: true, service: "rogue", ts: Date.now() });
  }

  // Core endpoint: run the gauntlet. Also serves as an A2MCP-style tool
  // (run_attack_suite) — an agent can POST { guardrails, targetName } and get
  // back a full machine-readable exploit report.
  if (method === "POST" && url === "/api/scan") {
    const body = await readBody(req);
    const report = runGauntlet({
      guardrails: Array.isArray(body.guardrails) ? body.guardrails : [],
      targetName: typeof body.targetName === "string" ? body.targetName : undefined,
    });
    return sendJson(res, 200, report);
  }

  if (method === "GET") return serveStatic(res, url);

  res.writeHead(405);
  res.end("Method not allowed");
});

server.listen(PORT, () => {
  console.log(`Rogue running → http://localhost:${PORT}`);
});
