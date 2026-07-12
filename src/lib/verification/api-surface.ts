import fs from "node:fs/promises";
import path from "node:path";

export interface ApiSurfaceSnapshot {
  exports: string[];
  main?: string;
  module?: string;
  types?: string;
  bin: string[];
}

export interface ApiSurfaceDiff {
  before: ApiSurfaceSnapshot;
  after: ApiSurfaceSnapshot;
  removedExports: string[];
  addedExports: string[];
  breaking: boolean;
}

async function readPackageExports(rootDir: string): Promise<ApiSurfaceSnapshot> {
  try {
    const raw = await fs.readFile(path.join(rootDir, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as {
      main?: string;
      module?: string;
      types?: string;
      exports?: Record<string, unknown> | string;
      bin?: Record<string, string> | string;
    };

    const exports: string[] = [];
    if (typeof pkg.exports === "string") {
      exports.push(pkg.exports);
    } else if (pkg.exports && typeof pkg.exports === "object") {
      exports.push(...Object.keys(pkg.exports));
    }

    const bin =
      typeof pkg.bin === "string"
        ? [pkg.bin]
        : pkg.bin
          ? Object.values(pkg.bin)
          : [];

    return {
      exports,
      main: pkg.main,
      module: pkg.module,
      types: pkg.types,
      bin,
    };
  } catch {
    return { exports: [], bin: [] };
  }
}

export async function compareApiSurface(
  baselineRoot: string,
  patchedRoot: string
): Promise<ApiSurfaceDiff> {
  const before = await readPackageExports(baselineRoot);
  const after = await readPackageExports(patchedRoot);
  const beforeSet = new Set([...before.exports, before.main, before.module, before.types].filter(Boolean) as string[]);
  const afterSet = new Set([...after.exports, after.main, after.module, after.types].filter(Boolean) as string[]);

  const removedExports = [...beforeSet].filter((e) => !afterSet.has(e));
  const addedExports = [...afterSet].filter((e) => !beforeSet.has(e));

  return {
    before,
    after,
    removedExports,
    addedExports,
    breaking: removedExports.length > 0,
  };
}
