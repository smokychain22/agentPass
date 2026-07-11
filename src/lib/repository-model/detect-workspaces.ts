import fs from "node:fs/promises";
import path from "node:path";
import type { FrameworkKind, ProjectRoot } from "./types";

export async function readJsonSafe<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function detectFrameworkFromPackage(pkg: {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}): FrameworkKind {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps.next) return "nextjs";
  if (deps.vite) return "vite";
  if (deps.react) return "react";
  return "node";
}

export async function findPackageJsonRoots(rootDir: string, maxDepth = 4): Promise<string[]> {
  const roots: string[] = [];

  async function walk(dir: string, depth: number) {
    if (depth > maxDepth) return;
    const pkgPath = path.join(dir, "package.json");
    try {
      await fs.access(pkgPath);
      roots.push(dir);
    } catch {
      // no package.json
    }
    let entries: string[] = [];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = path.join(dir, entry);
      try {
        const stat = await fs.stat(full);
        if (stat.isDirectory()) await walk(full, depth + 1);
      } catch {
        // skip
      }
    }
  }

  await walk(rootDir, 0);
  return roots.sort((a, b) => a.length - b.length);
}

export async function detectWorkspaces(rootDir: string): Promise<{
  workspaces: string[];
  monorepoTool: import("./types").RepositoryModel["monorepoTool"];
}> {
  const pkg = await readJsonSafe<{
    workspaces?: string[] | { packages?: string[] };
  }>(path.join(rootDir, "package.json"));

  const workspaces: string[] = [];
  if (pkg?.workspaces) {
    if (Array.isArray(pkg.workspaces)) workspaces.push(...pkg.workspaces);
    else if (Array.isArray(pkg.workspaces.packages)) workspaces.push(...pkg.workspaces.packages);
  }

  let monorepoTool: import("./types").RepositoryModel["monorepoTool"] = null;
  for (const tool of ["turbo.json", "nx.json", "pnpm-workspace.yaml"] as const) {
    try {
      await fs.access(path.join(rootDir, tool));
      if (tool === "turbo.json") monorepoTool = "turbo";
      if (tool === "nx.json") monorepoTool = "nx";
      if (tool === "pnpm-workspace.yaml") monorepoTool = "pnpm";
    } catch {
      // not present
    }
  }
  if (!monorepoTool && workspaces.length > 0) {
    monorepoTool = "npm";
  }

  return { workspaces, monorepoTool };
}
