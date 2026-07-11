import fs from "node:fs/promises";
import path from "node:path";
import type { Finding } from "@/lib/findings/types";
import type { RepositoryModel } from "@/lib/repository-model/types";
import { detectEntrypointRole, protectedRolesFor } from "@/lib/repository-model/detect-entrypoints";
import { isDoNotTouchPath, isRouteLikePath } from "@/lib/findings/confidence-path-rules";
import type { EvidenceItem, ReferenceChannelStatus } from "./types";

const CONFIG_GLOBS = [
  "package.json",
  "tsconfig.json",
  "jsconfig.json",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "vite.config.ts",
  "vitest.config.ts",
  "jest.config.js",
  "tailwind.config.js",
  "postcss.config.js",
  "eslint.config.js",
  ".eslintrc.json",
  "turbo.json",
  "nx.json",
];

const DYNAMIC_PATTERNS = [
  /import\s*\(\s*['"`]/,
  /require\s*\(\s*['"`]/,
  /import\.meta\.glob/,
  /React\.lazy\s*\(/,
  /lazy\s*\(\s*\(\)\s*=>\s*import/,
];

async function fileExists(root: string, rel: string): Promise<boolean> {
  try {
    await fs.access(path.join(root, rel));
    return true;
  } catch {
    return false;
  }
}

async function readJsonSafe<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function basenameVariants(rel: string): string[] {
  const norm = rel.replace(/\\/g, "/");
  const base = path.posix.basename(norm);
  const noExt = base.replace(/\.(tsx?|jsx?|mjs|cjs)$/i, "");
  return [norm, base, noExt];
}

async function grepRepoForStrings(
  rootDir: string,
  needles: string[],
  limit = 40
): Promise<string[]> {
  const hits: string[] = [];
  const queue = [rootDir];
  while (queue.length > 0 && hits.length < limit) {
    const dir = queue.pop()!;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.name === "node_modules" || ent.name === ".git" || ent.name === ".next") continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        queue.push(full);
        continue;
      }
      if (!/\.(tsx?|jsx?|mjs|cjs|json|ya?ml|mdx?)$/i.test(ent.name)) continue;
      let content: string;
      try {
        content = await fs.readFile(full, "utf8");
      } catch {
        continue;
      }
      for (const needle of needles) {
        if (needle.length < 3) continue;
        if (content.includes(needle)) {
          hits.push(path.relative(rootDir, full).replace(/\\/g, "/"));
          break;
        }
      }
    }
  }
  return hits;
}

async function checkPackageExports(
  rootDir: string,
  projectRoot: string,
  relPath: string
): Promise<EvidenceItem | null> {
  const pkgPath = path.join(rootDir, projectRoot, "package.json");
  const pkg = await readJsonSafe<{
    main?: string;
    module?: string;
    browser?: string;
    exports?: Record<string, unknown>;
    bin?: Record<string, string> | string;
  }>(pkgPath);
  if (!pkg) return null;

  const norm = relPath.replace(/\\/g, "/");
  const values = [
    pkg.main,
    pkg.module,
    pkg.browser,
    ...(typeof pkg.bin === "string" ? [pkg.bin] : Object.values(pkg.bin ?? {})),
    ...flattenExports(pkg.exports),
  ].filter(Boolean) as string[];

  const exported = values.some((v) => v === norm || v.endsWith(`/${norm}`) || norm.endsWith(v));
  if (!exported) return null;

  return {
    channel: "counter",
    source: "package.json",
    summary: `File appears in package.json exports or entry fields.`,
    strength: "contradicting",
  };
}

function flattenExports(exports: Record<string, unknown> | undefined, prefix = ""): string[] {
  if (!exports) return [];
  const out: string[] = [];
  for (const [key, val] of Object.entries(exports)) {
    if (typeof val === "string") out.push(val);
    else if (val && typeof val === "object") {
      out.push(...flattenExports(val as Record<string, unknown>, key));
    }
  }
  return out;
}

async function checkScriptReferences(
  rootDir: string,
  projectRoot: string,
  relPath: string
): Promise<EvidenceItem[]> {
  const pkgPath = path.join(rootDir, projectRoot, "package.json");
  const pkg = await readJsonSafe<{ scripts?: Record<string, string> }>(pkgPath);
  if (!pkg?.scripts) return [];

  const needles = basenameVariants(relPath);
  const items: EvidenceItem[] = [];
  for (const [name, script] of Object.entries(pkg.scripts)) {
    if (needles.some((n) => script.includes(n))) {
      items.push({
        channel: "counter",
        source: `package.json#scripts.${name}`,
        summary: `Referenced by npm script "${name}".`,
        strength: "contradicting",
      });
    }
  }
  return items;
}

async function checkConfigReferences(
  rootDir: string,
  projectRoot: string,
  relPath: string
): Promise<EvidenceItem[]> {
  const needles = basenameVariants(relPath);
  const items: EvidenceItem[] = [];
  for (const cfg of CONFIG_GLOBS) {
    const cfgPath = path.join(rootDir, projectRoot, cfg);
    if (!(await fileExists(rootDir, path.join(projectRoot, cfg)))) continue;
    let content: string;
    try {
      content = await fs.readFile(cfgPath, "utf8");
    } catch {
      continue;
    }
    if (needles.some((n) => content.includes(n))) {
      items.push({
        channel: "configuration",
        source: cfg,
        summary: `Path or basename referenced in ${cfg}.`,
        strength: "contradicting",
      });
    }
  }
  return items;
}

async function checkDynamicReferences(
  rootDir: string,
  relPath: string
): Promise<{ items: EvidenceItem[]; checked: boolean }> {
  const needles = basenameVariants(relPath);
  const hits = await grepRepoForStrings(rootDir, needles, 8);
  const dynamicHits: string[] = [];

  for (const file of hits.slice(0, 12)) {
    if (file === relPath) continue;
    let content: string;
    try {
      content = await fs.readFile(path.join(rootDir, file), "utf8");
    } catch {
      continue;
    }
    if (DYNAMIC_PATTERNS.some((p) => p.test(content)) && needles.some((n) => content.includes(n))) {
      dynamicHits.push(file);
    }
  }

  if (dynamicHits.length === 0) {
    return { items: [], checked: true };
  }

  return {
    checked: true,
    items: [
      {
        channel: "counter",
        source: "dynamic_import_scan",
        summary: `Possible dynamic import/reference in: ${dynamicHits.slice(0, 3).join(", ")}`,
        strength: "contradicting",
      },
    ],
  };
}

function frameworkCounterEvidence(
  relPath: string,
  repositoryModel?: RepositoryModel
): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  const norm = relPath.replace(/\\/g, "/");

  if (isDoNotTouchPath(norm) || isRouteLikePath(norm)) {
    items.push({
      channel: "framework",
      source: "protected_path_rules",
      summary: "Path matches protected route/config pattern.",
      strength: "contradicting",
    });
  }

  const role = detectEntrypointRole(norm);
  if (role !== "library" && role !== "unknown") {
    items.push({
      channel: "framework",
      source: "entrypoint_registry",
      summary: `Framework entry-point role: ${role}`,
      strength: "contradicting",
    });
  }

  const ctx = repositoryModel?.fileIndex?.[norm];
  if (ctx?.protectedRoles?.length) {
    items.push({
      channel: "framework",
      source: "repository_model",
      summary: `Protected roles: ${ctx.protectedRoles.join(", ")}`,
      strength: "contradicting",
    });
  }

  if (ctx?.entrypointRole && ctx.entrypointRole !== "library") {
    const roles = protectedRolesFor(ctx.entrypointRole);
    if (roles.length > 0) {
      items.push({
        channel: "framework",
        source: "repository_model",
        summary: `Convention-based entry point (${ctx.entrypointRole}).`,
        strength: "contradicting",
      });
    }
  }

  return items;
}

export async function searchCounterEvidence(input: {
  finding: Finding;
  rootDir: string;
  repositoryModel?: RepositoryModel;
}): Promise<{ items: EvidenceItem[]; channels: ReferenceChannelStatus }> {
  const { finding, rootDir, repositoryModel } = input;
  const rel = finding.files[0]?.replace(/\\/g, "/");
  const projectRoot = finding.projectRoot ?? repositoryModel?.projects[0]?.relativePath ?? "";

  const items: EvidenceItem[] = [
    ...frameworkCounterEvidence(rel ?? "", repositoryModel),
  ];

  const channels: ReferenceChannelStatus = {
    staticImports: finding.evidence.signals.some((s) => s.startsWith("inbound_refs=")),
    dynamicImports: false,
    configuration: false,
    scripts: false,
    packageExports: false,
    frameworkEntryPoint: items.some((i) => i.source === "entrypoint_registry"),
    incomplete: [],
  };

  if (!rel) {
    channels.incomplete.push("no_file_path");
    return { items, channels };
  }

  const pkgExport = await checkPackageExports(rootDir, projectRoot, rel);
  if (pkgExport) {
    items.push(pkgExport);
    channels.packageExports = true;
  } else {
    channels.packageExports = true;
  }

  const scriptItems = await checkScriptReferences(rootDir, projectRoot, rel);
  if (scriptItems.length > 0) {
    items.push(...scriptItems);
    channels.scripts = true;
  } else {
    channels.scripts = true;
  }

  const configItems = await checkConfigReferences(rootDir, projectRoot, rel);
  if (configItems.length > 0) {
    items.push(...configItems);
    channels.configuration = true;
  } else {
    channels.configuration = true;
  }

  const dynamic = await checkDynamicReferences(rootDir, rel);
  items.push(...dynamic.items);
  channels.dynamicImports = dynamic.checked;

  if (finding.type === "orphan_pattern" && finding.sourceMode === "fallback") {
    items.push({
      channel: "counter",
      source: "madge_fallback",
      summary: "Orphan signal from fallback graph only — not native confirmation.",
      strength: "contradicting",
    });
    channels.incomplete.push("native_graph_unreachable");
  }

  if (finding.type === "unused_file" && !channels.staticImports) {
    channels.incomplete.push("static_import_scan");
  }

  return { items, channels };
}
