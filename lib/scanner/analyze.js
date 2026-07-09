import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import simpleGit from "simple-git";
import { reposDir } from "../store.js";

const execFileAsync = promisify(execFile);

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".turbo",
  "coverage",
  ".vercel",
]);

const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

const SLOP_PATTERNS = [
  { re: /(Final|New|Old|Copy|Backup|V2|V3|_old|_new|_copy|_backup)\.(tsx?|jsx?)$/i, reason: "AI duplicate naming pattern" },
  { re: /Button\d+\.(tsx?|jsx?)$/i, reason: "Numbered component duplicate" },
  { re: /Component\d+\.(tsx?|jsx?)$/i, reason: "Numbered component duplicate" },
  { re: /\.bak$/i, reason: "Backup file" },
  { re: /_deprecated\./i, reason: "Deprecated file marker" },
  { re: /\/old\//i, reason: "Abandoned old/ folder" },
  { re: /\/backup\//i, reason: "Backup folder" },
  { re: /\/unused\//i, reason: "Unused folder" },
];

export async function resolveRepoPath({ repoUrl, branch, demo = false, zipPath = null }) {
  if (demo) {
    const demoPath = path.join(process.cwd(), "demo-repo");
    if (!fs.existsSync(demoPath)) throw new Error("Demo repo not found");
    return { localPath: demoPath, source: "demo" };
  }
  if (zipPath && fs.existsSync(zipPath)) {
    return { localPath: zipPath, source: "zip" };
  }
  if (!repoUrl) throw new Error("repoUrl required");
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/i);
  if (!match) throw new Error("Only public GitHub URLs supported in v1");
  const owner = match[1];
  const repo = match[2].replace(/\.git$/, "");
  const dir = path.join(reposDir(), `${owner}_${repo}_${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  const git = simpleGit();
  await git.clone(`https://github.com/${owner}/${repo}.git`, dir, [
    "--depth",
    "1",
    ...(branch ? ["--branch", branch] : []),
  ]);
  return { localPath: dir, source: "github", owner, repo };
}

export function walkFiles(root, rel = "") {
  const out = [];
  if (!fs.existsSync(root)) return out;
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const relPath = rel ? `${rel}/${ent.name}` : ent.name;
    const abs = path.join(root, relPath);
    if (ent.isDirectory()) {
      out.push(...walkFiles(abs, relPath));
    } else {
      out.push(relPath);
    }
  }
  return out;
}

export function detectFramework(root) {
  const pkgPath = path.join(root, "package.json");
  if (!fs.existsSync(pkgPath)) return "Unknown";
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.next) return "Next.js";
    if (deps.vite) return "Vite";
    if (deps.react) return "React";
    return "JavaScript";
  } catch {
    return "Unknown";
  }
}

function readPkg(root) {
  const p = path.join(root, "package.json");
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function slopFingerprint(files) {
  const findings = [];
  for (const f of files) {
    for (const pat of SLOP_PATTERNS) {
      if (pat.re.test(f)) {
        findings.push({
          type: "ai_slop",
          file_path: f,
          reason: pat.reason,
          confidence: 0.85,
          severity: "review",
          action: "REVIEW_FIRST",
        });
        break;
      }
    }
  }
  return findings;
}

function findOrphanRoutes(root, files) {
  const findings = [];
  const apiFiles = files.filter((f) => f.includes("/api/") && CODE_EXT.has(path.extname(f)));
  const appRoutes = files.filter((f) => f.match(/app\/.*\/page\.(tsx|jsx|js)$/));
  for (const f of apiFiles) {
    const base = path.basename(f, path.extname(f));
    if (base === "route" && f.includes("/api/")) {
      const imported = files.some(
        (other) =>
          other !== f &&
          CODE_EXT.has(path.extname(other)) &&
          fs.readFileSync(path.join(root, other), "utf8").includes(f.replace(/\.(tsx?|jsx?)$/, "")),
      );
      if (!imported) {
        findings.push({
          type: "orphan_route",
          file_path: f,
          reason: "API route file with no detected importers",
          confidence: 0.7,
          severity: "review",
          action: "REVIEW_FIRST",
        });
      }
    }
  }
  if (appRoutes.length > 8) {
    findings.push({
      type: "route_bloat",
      file_path: "app/",
      reason: `${appRoutes.length} page routes — possible duplicate pages`,
      confidence: 0.6,
      severity: "info",
      action: "REVIEW_FIRST",
    });
  }
  return findings;
}

function findDuplicateNames(files) {
  const byBase = new Map();
  for (const f of files) {
    if (!CODE_EXT.has(path.extname(f))) continue;
    const base = path.basename(f, path.extname(f)).toLowerCase();
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(f);
  }
  const findings = [];
  for (const [base, paths] of byBase) {
    if (paths.length > 1 && !["index", "route", "page", "layout"].includes(base)) {
      findings.push({
        type: "duplicate_cluster",
        file_path: paths.join(", "),
        reason: `Multiple files share base name "${base}"`,
        confidence: 0.9,
        severity: "high",
        action: "REVIEW_FIRST",
        cluster: paths,
      });
    }
  }
  return findings;
}

function findUnusedDeps(root) {
  const pkg = readPkg(root);
  if (!pkg) return [];
  const deps = Object.keys(pkg.dependencies || {});
  const files = walkFiles(root).filter((f) => CODE_EXT.has(path.extname(f)));
  const allCode = files
    .map((f) => {
      try {
        return fs.readFileSync(path.join(root, f), "utf8");
      } catch {
        return "";
      }
    })
    .join("\n");
  const findings = [];
  for (const dep of deps) {
    const patterns = [
      new RegExp(`from ['"]${dep}(/|['"])`, "g"),
      new RegExp(`require\\(['"]${dep}(/|['"])`, "g"),
      new RegExp(`import\\(['"]${dep}(/|['"])`, "g"),
    ];
    const used = patterns.some((p) => p.test(allCode));
    if (!used && !dep.startsWith("@types/")) {
      findings.push({
        type: "unused_dependency",
        file_path: "package.json",
        reason: `Dependency "${dep}" not found in import/require scan`,
        confidence: 0.75,
        severity: "medium",
        action: "SAFE_DELETE",
        package: dep,
      });
    }
  }
  return findings;
}

function findDeadFiles(root, files) {
  const findings = [];
  const codeFiles = files.filter((f) => CODE_EXT.has(path.extname(f)));
  const entryHints = ["app/page", "app/layout", "pages/index", "src/main", "src/index", "index"];
  const importGraph = new Map();
  for (const f of codeFiles) {
    const content = fs.readFileSync(path.join(root, f), "utf8");
    importGraph.set(f, content);
  }
  for (const f of codeFiles) {
    const base = path.basename(f);
    if (entryHints.some((h) => f.includes(h))) continue;
    if (f.includes("route.ts") || f.includes("route.js")) continue;
    const nameStem = path.basename(f, path.extname(f));
    let refs = 0;
    for (const [other, content] of importGraph) {
      if (other === f) continue;
      if (
        content.includes(`/${nameStem}"`) ||
        content.includes(`/${nameStem}'`) ||
        content.includes(`./${nameStem}`) ||
        content.includes(`'${nameStem}'`) ||
        content.includes(`"${nameStem}"`)
      ) {
        refs++;
      }
    }
    if (refs === 0 && (f.includes("/components/") || f.includes("/lib/") || f.includes("/utils/"))) {
      findings.push({
        type: "dead_file",
        file_path: f,
        reason: "No import references detected",
        confidence: 0.65,
        severity: "medium",
        action: "REVIEW_FIRST",
      });
    }
  }
  return findings;
}

async function runKnip(root) {
  try {
    const { stdout } = await execFileAsync(
      "npx",
      ["--yes", "knip", "--reporter", "json", "--no-progress"],
      { cwd: root, timeout: 120000, maxBuffer: 10 * 1024 * 1024 },
    );
    const data = JSON.parse(stdout);
    const findings = [];
    for (const file of data.files || []) {
      findings.push({
        type: "dead_file",
        file_path: file,
        reason: "Knip: unused file",
        confidence: 0.95,
        severity: "high",
        action: "SAFE_DELETE",
        source: "knip",
      });
    }
    for (const dep of data.dependencies || []) {
      findings.push({
        type: "unused_dependency",
        file_path: "package.json",
        reason: `Knip: unused dependency ${dep}`,
        confidence: 0.95,
        severity: "high",
        action: "SAFE_DELETE",
        package: dep,
        source: "knip",
      });
    }
    return findings;
  } catch {
    return [];
  }
}

export function computeBloatScore(findings) {
  const weights = {
    ai_slop: 3,
    duplicate_cluster: 5,
    dead_file: 4,
    unused_dependency: 3,
    orphan_route: 4,
    route_bloat: 2,
  };
  let raw = 0;
  for (const f of findings) {
    raw += weights[f.type] || 2;
  }
  return Math.min(100, Math.round(raw * 1.2));
}

export async function runScan(localPath, mode = "deep") {
  const files = walkFiles(localPath);
  const framework = detectFramework(localPath);

  let findings = [
    ...slopFingerprint(files),
    ...findDuplicateNames(files),
    ...findDeadFiles(localPath, files),
    ...findUnusedDeps(localPath),
    ...findOrphanRoutes(localPath, files),
  ];

  if (mode === "deep") {
    const knipFindings = await runKnip(localPath);
    const seen = new Set(findings.map((f) => `${f.type}:${f.file_path}:${f.reason}`));
    for (const kf of knipFindings) {
      const key = `${kf.type}:${kf.file_path}:${kf.reason}`;
      if (!seen.has(key)) findings.push(kf);
    }
  }

  const clusters = findings.filter((f) => f.type === "duplicate_cluster").length;
  const unusedFiles = findings.filter((f) => f.type === "dead_file").length;
  const unusedDeps = findings.filter((f) => f.type === "unused_dependency").length;
  const orphanRoutes = findings.filter((f) => f.type === "orphan_route").length;
  const slop = findings.filter((f) => f.type === "ai_slop").length;
  const reviewRequired = findings.filter((f) => f.action === "REVIEW_FIRST").length;

  const bloatScore = computeBloatScore(findings);
  const fileCount = files.filter((f) => CODE_EXT.has(path.extname(f))).length;

  return {
    framework,
    fileCount,
    findings,
    summary: {
      bloat_score: bloatScore,
      duplicate_clusters: clusters,
      unused_files: unusedFiles,
      unused_dependencies: unusedDeps,
      orphan_routes: orphanRoutes,
      ai_slop_hits: slop,
      review_required: reviewRequired,
      safe_deletes: findings.filter((f) => f.action === "SAFE_DELETE").length,
    },
    fingerprint: {
      patterns: slop,
      duplicate_clusters: clusters,
      total_findings: findings.length,
    },
  };
}
