import type { GitTreeEntry } from "@/lib/coverage/git-tree-inventory";
import type { RepositoryPathNode } from "./types";
import {
  fileNameOf,
  guessLanguage,
  normalizeTrackedPath,
  pathIdFor,
  pathIndicators,
} from "./path-identity";

export function inventoryNodesFromTree(
  entries: GitTreeEntry[],
  options?: {
    findingPathIndex?: Map<string, string[]>;
    inboundRefs?: Map<string, number>;
  }
): RepositoryPathNode[] {
  const nodes: RepositoryPathNode[] = [];
  const dirs = new Set<string>();

  for (const entry of entries) {
    if (entry.type !== "blob" && entry.type !== "commit") continue;
    const path = normalizeTrackedPath(entry.path);
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join("/"));
    }
    const indicators = pathIndicators(path);
    nodes.push({
      pathId: pathIdFor(path),
      path,
      name: fileNameOf(path),
      type: "blob",
      sha: entry.sha,
      size: entry.size,
      language: guessLanguage(path),
      generated: indicators.generated,
      vendor: indicators.vendor,
      protected: indicators.protected,
      findingIds: options?.findingPathIndex?.get(path) ?? [],
      inboundRefs: options?.inboundRefs?.get(path),
      indicators: indicators.indicators,
    });
  }

  for (const dir of [...dirs].sort()) {
    const indicators = pathIndicators(dir);
    nodes.push({
      pathId: pathIdFor(dir),
      path: dir,
      name: fileNameOf(dir),
      type: "tree",
      generated: indicators.generated,
      vendor: indicators.vendor,
      protected: indicators.protected,
      indicators: indicators.indicators,
    });
  }

  return nodes.sort((a, b) => a.path.localeCompare(b.path));
}

export function filterInventoryNodes(
  nodes: RepositoryPathNode[],
  filters: {
    search?: string;
    language?: string;
    onlyBlobs?: boolean;
    prefix?: string;
    hideVendor?: boolean;
    hideGenerated?: boolean;
  }
): RepositoryPathNode[] {
  const search = filters.search?.trim().toLowerCase();
  return nodes.filter((node) => {
    if (filters.onlyBlobs && node.type !== "blob") return false;
    if (filters.hideVendor && node.vendor) return false;
    if (filters.hideGenerated && node.generated) return false;
    if (filters.language && node.language !== filters.language) return false;
    if (filters.prefix) {
      const pre = normalizeTrackedPath(filters.prefix);
      if (node.path !== pre && !node.path.startsWith(`${pre}/`)) return false;
    }
    if (search && !node.path.toLowerCase().includes(search)) return false;
    return true;
  });
}

export function selectFolderContents(
  allBlobPaths: string[],
  folderPath: string
): string[] {
  const pre = normalizeTrackedPath(folderPath);
  if (!pre) return [...allBlobPaths];
  return allBlobPaths.filter((p) => p === pre || p.startsWith(`${pre}/`));
}
