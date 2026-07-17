import type { FileSummary } from "./types";
import {
  buildFullRepositoryInventory,
  type FullRepositoryInventory,
  type InventoryFileRecord,
} from "./inventory";

export interface FileTreeScan {
  summary: FileSummary;
  topLevelFolders: string[];
  allRelativePaths: string[];
  largestFiles: { path: string; sizeKb: number }[];
  inventory?: FullRepositoryInventory;
  inventoryFiles?: InventoryFileRecord[];
}

export async function scanFileTree(rootDir: string): Promise<FileTreeScan> {
  const inventory = await buildFullRepositoryInventory(rootDir);
  const extensions: Record<string, number> = {};
  for (const file of inventory.files) {
    extensions[file.extension] = (extensions[file.extension] ?? 0) + 1;
  }

  const topExtensions = Object.fromEntries(
    Object.entries(extensions)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
  );

  const largestFiles = [...inventory.files]
    .sort((a, b) => b.sizeBytes - a.sizeBytes)
    .slice(0, 8)
    .map((f) => ({
      path: f.path,
      sizeKb: Math.round((f.sizeBytes / 1024) * 10) / 10,
    }));

  return {
    summary: {
      totalFiles: inventory.files.length,
      totalFolders: inventory.topLevelFolders.length,
      totalSizeKb: Math.round(inventory.totalBytes / 1024),
      topExtensions,
    },
    topLevelFolders: inventory.topLevelFolders,
    allRelativePaths: inventory.allRelativePaths,
    largestFiles,
    inventory,
    inventoryFiles: inventory.files,
  };
}
