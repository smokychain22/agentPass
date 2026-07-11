import fs from "node:fs/promises";
import path from "node:path";
import { classifyProjectRoots } from "./primary-root";
import { projectRootPrefixes } from "./primary-root";
import type { RepositoryModel } from "./types";

export function normalizeProjectRoot(root: string | undefined | null): string {
  if (!root || root === ".") return "";
  return root.replace(/\\/g, "/").replace(/\/$/, "");
}

export function isUnderMirrorPrefix(filePath: string, mirrorPrefixes: string[]): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return mirrorPrefixes.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`)
  );
}

export async function detectPhysicalMirrorPrefixes(repositoryRoot: string): Promise<string[]> {
  const mirrors: string[] = [];
  const rootSrc = path.join(repositoryRoot, "src");
  let rootSrcExists = false;
  try {
    await fs.access(rootSrc);
    rootSrcExists = true;
  } catch {
    return mirrors;
  }

  let entries: string[] = [];
  try {
    entries = await fs.readdir(repositoryRoot);
  } catch {
    return mirrors;
  }

  for (const entry of entries) {
    if (entry.startsWith(".") || entry === "node_modules" || entry === "src") continue;
    const candidate = path.join(repositoryRoot, entry);
    const stat = await fs.stat(candidate).catch(() => null);
    if (!stat?.isDirectory()) continue;
    const nestedSrc = path.join(candidate, "src");
    try {
      await fs.access(nestedSrc);
      if (rootSrcExists) mirrors.push(entry);
    } catch {
      /* not a mirrored src tree */
    }
  }

  return [...new Set(mirrors)];
}

export async function collectMirrorPrefixes(
  model: RepositoryModel,
  repositoryRoot?: string
): Promise<string[]> {
  const fromProjects = projectRootPrefixes(model);
  const classified = classifyProjectRoots(model)
    .filter((p) => p.role === "nested_copy" || p.role === "artifact")
    .map((p) => p.relativePath)
    .filter(Boolean);
  const physical = repositoryRoot ? await detectPhysicalMirrorPrefixes(repositoryRoot) : [];
  return [...new Set([...fromProjects, ...classified, ...physical])];
}

export function stripMirrorPathsFromFindingFiles(
  files: string[],
  mirrorPrefixes: string[]
): string[] {
  return files.filter((file) => !isUnderMirrorPrefix(file, mirrorPrefixes));
}
