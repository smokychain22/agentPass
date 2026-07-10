import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { IGNORED_DIRS } from "@/lib/scanner/types";
import { SKIP_EXTENSIONS } from "../types";

const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const MAX_GRAPH_FILES = 2500;

const IMPORT_RE =
  /(?:import\s+(?:type\s+)?(?:[\w*{}\s,$]+from\s+)?|export\s+.*from\s+|require\s*\(\s*)['"]([^'"]+)['"]/g;

export interface ImportGraphAnalysis {
  allFiles: string[];
  entryPoints: string[];
  reachable: Set<string>;
  unusedFiles: string[];
  unusedDependencies: string[];
  orphans: string[];
  circular: string[][];
  imports: Map<string, string[]>;
}

async function walkCodeFiles(rootDir: string): Promise<{ rel: string; content: string }[]> {
  const out: { rel: string; content: string }[] = [];

  async function walk(dir: string, rel: string): Promise<void> {
    if (out.length >= MAX_GRAPH_FILES) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const relative = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(full, relative);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!CODE_EXT.has(ext) || SKIP_EXTENSIONS.has(ext)) continue;
        try {
          const content = await fs.readFile(full, "utf8");
          out.push({ rel: relative.replace(/\\/g, "/"), content });
        } catch {
          /* unreadable */
        }
      }
    }
  }

  await walk(rootDir, "");
  return out;
}

function extractImports(content: string): string[] {
  const specs: string[] = [];
  for (const match of content.matchAll(IMPORT_RE)) {
    if (match[1]) specs.push(match[1]);
  }
  return specs;
}

async function loadTsconfigPaths(rootDir: string): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(path.join(rootDir, "tsconfig.json"), "utf8");
    const parsed = JSON.parse(raw) as {
      compilerOptions?: { paths?: Record<string, string[]> };
    };
    const paths = parsed.compilerOptions?.paths ?? {};
    const out: Record<string, string> = {};
    for (const [alias, targets] of Object.entries(paths)) {
      const key = alias.replace(/\*$/, "");
      const target = targets[0]?.replace(/\*$/, "") ?? "";
      if (key && target) out[key] = target.replace(/^\.\//, "");
    }
    return out;
  } catch {
    return {};
  }
}

async function discoverNextEntryPoints(rootDir: string): Promise<string[]> {
  const entries = new Set<string>();
  const routeFiles = [
    "page.tsx",
    "page.ts",
    "page.jsx",
    "page.js",
    "layout.tsx",
    "layout.ts",
    "route.ts",
    "route.js",
    "loading.tsx",
    "error.tsx",
    "not-found.tsx",
  ];

  async function walk(dir: string, rel: string): Promise<void> {
    const full = path.join(rootDir, rel);
    let items: Dirent[];
    try {
      items = await fs.readdir(full, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      if (IGNORED_DIRS.has(item.name)) continue;
      const childRel = rel ? `${rel}/${item.name}` : item.name;
      if (item.isDirectory()) {
        await walk(dir, childRel);
      } else if (routeFiles.includes(item.name)) {
        entries.add(childRel.replace(/\\/g, "/"));
      }
    }
  }

  for (const root of ["app", "src/app", "pages", "src/pages"]) {
    await walk(rootDir, root);
  }

  for (const special of ["middleware.ts", "middleware.js", "instrumentation.ts", "src/instrumentation.ts"]) {
    try {
      await fs.access(path.join(rootDir, special));
      entries.add(special);
    } catch {
      /* skip */
    }
  }

  return [...entries];
}

async function resolveEntryPoints(rootDir: string): Promise<string[]> {
  const found = new Set<string>(await discoverNextEntryPoints(rootDir));
  const candidates = [
    "app/page.tsx",
    "app/page.ts",
    "app/layout.tsx",
    "pages/index.tsx",
    "pages/index.ts",
    "src/index.ts",
    "src/index.tsx",
    "src/main.ts",
    "index.ts",
    "index.js",
  ];
  for (const c of candidates) {
    try {
      await fs.access(path.join(rootDir, c));
      found.add(c);
    } catch {
      /* skip */
    }
  }
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf8")) as {
      main?: string;
      module?: string;
    };
    for (const entry of [pkg.main, pkg.module].filter(Boolean) as string[]) {
      found.add(entry);
    }
  } catch {
    /* no package.json */
  }
  return found.size ? [...found] : ["app/page.tsx", "pages/index.tsx", "src/index.ts", "index.ts"];
}

function resolveImport(
  fromFile: string,
  spec: string,
  fileSet: Set<string>,
  aliasPaths: Record<string, string>
): string | null {
  for (const [alias, target] of Object.entries(aliasPaths)) {
    if (spec === alias || spec.startsWith(alias)) {
      const rest = spec.slice(alias.length);
      const joined = path.posix.join(target, rest);
      const tries = [
        joined,
        `${joined}.ts`,
        `${joined}.tsx`,
        `${joined}.js`,
        `${joined}.jsx`,
        `${joined}/index.ts`,
        `${joined}/index.tsx`,
      ];
      for (const t of tries) {
        if (fileSet.has(t)) return t;
      }
    }
  }

  if (spec.startsWith(".") || spec.startsWith("/")) {
    const base = path.posix.dirname(fromFile);
    const joined = path.posix.normalize(path.posix.join(base, spec));
    const tries = [
      joined,
      `${joined}.ts`,
      `${joined}.tsx`,
      `${joined}.js`,
      `${joined}.jsx`,
      `${joined}/index.ts`,
      `${joined}/index.tsx`,
    ];
    for (const t of tries) {
      if (fileSet.has(t)) return t;
    }
  }
  return null;
}

function bfsReachable(
  entryPoints: string[],
  imports: Map<string, string[]>,
  fileSet: Set<string>
): Set<string> {
  const reachable = new Set<string>();
  const queue = entryPoints.filter((e) => fileSet.has(e));
  while (queue.length) {
    const cur = queue.shift()!;
    if (reachable.has(cur)) continue;
    reachable.add(cur);
    for (const dep of imports.get(cur) ?? []) {
      if (fileSet.has(dep) && !reachable.has(dep)) queue.push(dep);
    }
  }
  return reachable;
}

function findCycles(imports: Map<string, string[]>, fileSet: Set<string>): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const stack = new Set<string>();
  const pathStack: string[] = [];

  function dfs(node: string): void {
    if (stack.has(node)) {
      const idx = pathStack.indexOf(node);
      if (idx >= 0) cycles.push(pathStack.slice(idx).concat(node));
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    stack.add(node);
    pathStack.push(node);
    for (const next of imports.get(node) ?? []) {
      if (fileSet.has(next)) dfs(next);
    }
    pathStack.pop();
    stack.delete(node);
  }

  for (const f of fileSet) dfs(f);
  return cycles.slice(0, 20);
}

async function detectUnusedDependencies(
  rootDir: string,
  files: { rel: string; content: string }[]
): Promise<string[]> {
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf8"));
  } catch {
    return [];
  }

  const allDeps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };
  const corpus = files.map((f) => f.content).join("\n");
  const unused: string[] = [];

  for (const dep of Object.keys(allDeps)) {
    const patterns = [
      `from '${dep}'`,
      `from "${dep}"`,
      `require('${dep}')`,
      `require("${dep}")`,
      `import('${dep}')`,
    ];
    if (!patterns.some((p) => corpus.includes(p))) {
      unused.push(dep);
    }
  }
  return unused;
}

export async function analyzeImportGraph(rootDir: string): Promise<ImportGraphAnalysis> {
  const files = await walkCodeFiles(rootDir);
  const fileSet = new Set(files.map((f) => f.rel));
  const aliasPaths = await loadTsconfigPaths(rootDir);
  const imports = new Map<string, string[]>();

  for (const file of files) {
    const resolved: string[] = [];
    for (const spec of extractImports(file.content)) {
      const target = resolveImport(file.rel, spec, fileSet, aliasPaths);
      if (target) resolved.push(target);
    }
    imports.set(file.rel, resolved);
  }

  const entryPoints = await resolveEntryPoints(rootDir);
  const reachable = bfsReachable(entryPoints, imports, fileSet);
  const unusedFiles = files.map((f) => f.rel).filter((f) => !reachable.has(f));
  const orphans = unusedFiles.filter((f) => {
    const hasInbound = [...imports.entries()].some(([, deps]) => deps.includes(f));
    return !hasInbound && !entryPoints.includes(f);
  });
  const circular = findCycles(imports, fileSet);
  const unusedDependencies = await detectUnusedDependencies(rootDir, files);

  return {
    allFiles: files.map((f) => f.rel),
    entryPoints,
    reachable,
    unusedFiles,
    unusedDependencies,
    orphans,
    circular,
    imports,
  };
}
