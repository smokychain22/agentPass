import fs from "node:fs/promises";
import path from "node:path";
import { findPackageJsonRoots, readJsonSafe, detectFrameworkFromPackage } from "./detect-workspaces";
import { detectWorkspaces } from "./detect-workspaces";
import { resolveFileContext } from "./detect-entrypoints";
import type { ProjectRoot, RepositoryModel } from "./types";

export async function buildRepositoryModel(rootDir: string): Promise<RepositoryModel> {
  const packageRoots = await findPackageJsonRoots(rootDir);
  const { workspaces, monorepoTool } = await detectWorkspaces(rootDir);

  const projects: ProjectRoot[] = [];
  for (const absRoot of packageRoots) {
    const pkg = await readJsonSafe<{ name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>(
      path.join(absRoot, "package.json")
    );
    if (!pkg) continue;
    const relativePath = path.relative(rootDir, absRoot).replace(/\\/g, "/") || "";
    projects.push({
      projectRoot: absRoot,
      packageName: pkg.name ?? (relativePath || "root"),
      relativePath,
      framework: detectFrameworkFromPackage(pkg),
      runtimeTarget: detectFrameworkFromPackage(pkg) === "nextjs" ? "mixed" : "browser",
      workspaceMember: relativePath.length > 0,
    });
  }

  if (projects.length === 0) {
    projects.push({
      projectRoot: rootDir,
      packageName: "root",
      relativePath: "",
      framework: "unknown",
      runtimeTarget: "unknown",
    });
  }

  const fileIndex: RepositoryModel["fileIndex"] = {};
  await indexFiles(rootDir, rootDir, projects, fileIndex);

  return {
    repositoryRoot: rootDir,
    projects,
    workspaces,
    monorepoTool,
    fileIndex,
    detectedAt: new Date().toISOString(),
  };
}

async function indexFiles(
  rootDir: string,
  dir: string,
  projects: ProjectRoot[],
  fileIndex: RepositoryModel["fileIndex"],
  depth = 0
): Promise<void> {
  if (depth > 8) return;
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git" || entry === ".next" || entry === "dist") continue;
    const full = path.join(dir, entry);
    let stat;
    try {
      stat = await fs.stat(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      await indexFiles(rootDir, full, projects, fileIndex, depth + 1);
      continue;
    }
    if (!/\.(tsx?|jsx?|mjs|cjs|json)$/.test(entry)) continue;
    const rel = path.relative(rootDir, full).replace(/\\/g, "/");
    fileIndex[rel] = resolveFileContext(rel, projects);
  }
}

export function projectSummary(model: RepositoryModel): Array<Record<string, unknown>> {
  return model.projects.map((p) => ({
    packageName: p.packageName,
    projectRoot: p.relativePath || ".",
    framework: p.framework,
    runtimeTarget: p.runtimeTarget,
    workspaceMember: p.workspaceMember ?? false,
  }));
}
