import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import type { Finding } from "@/lib/findings/types";
import { detectPackageManager } from "@/lib/scanner/detect-package-manager";
import type { PackageManager } from "@/lib/scanner/types";
import {
  removeUnusedSymbolFromImport,
  convertSymbolToTypeOnlyImport,
  removeUnusedSymbolAtLine,
} from "@/lib/findings/unused-import-detector";
import { buildTextDiff } from "../fix-preflight";
import { generateUnifiedDeletePatch } from "@/lib/patch-kit/generate-unified-diff";
import type { ClassifiedItem } from "@/lib/patch-kit/types";
import { resolvePhase1TransformPlugin, type Phase1PluginId } from "./phase1-plugins";
import { defaultStrategyForPlugin } from "../fix-strategies";
import {
  hashSource,
  validateTransformInvariants,
  type TransformAuditRecord,
} from "../transform-audit";

export interface AppliedFix {
  pluginId: Phase1PluginId;
  strategyId: string;
  unifiedDiff: string;
  changedPaths: string[];
  originalSources: Record<string, string>;
  modifiedSources: Record<string, string>;
  expectedFix: string;
  generatedChange?: {
    originalSource: string;
    modifiedSource: string;
    originalHash: string;
    modifiedHash: string;
    unifiedDiff: string;
  };
  transformAudit?: TransformAuditRecord;
}

async function readSourceMap(
  rootDir: string,
  paths: string[]
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const rel of paths) {
    try {
      out[rel] = await fs.readFile(path.join(rootDir, rel), "utf8");
    } catch {
      out[rel] = "";
    }
  }
  return out;
}

async function ensureGitBaseline(rootDir: string): Promise<void> {
  await execa("git", ["init"], { cwd: rootDir, reject: false });
  await execa("git", ["add", "-A"], { cwd: rootDir, reject: false });
  await execa(
    "git",
    [
      "-c",
      "user.email=repodiet@local",
      "-c",
      "user.name=RepoDiet",
      "commit",
      "-m",
      "baseline",
      "--allow-empty",
    ],
    { cwd: rootDir, reject: false }
  );
}

async function gitDiff(rootDir: string, paths?: string[]): Promise<string> {
  const args = ["diff", "--no-color", "HEAD", "--", ...(paths ?? [])];
  const diff = await execa("git", args, { cwd: rootDir, reject: false });
  const out = diff.stdout ?? "";
  if (!out.trim()) return "";
  return out.endsWith("\n") ? out : `${out}\n`;
}

function uninstallCommand(pm: PackageManager, packageName: string): string[] {
  switch (pm) {
    case "pnpm":
      return ["pnpm", "remove", packageName];
    case "yarn":
      return ["yarn", "remove", packageName];
    case "bun":
      return ["bun", "remove", packageName];
    default:
      return ["npm", "uninstall", packageName, "--no-audit", "--no-fund"];
  }
}

async function applyRemoveTempFile(
  rootDir: string,
  finding: Finding,
  strategyId: string
): Promise<AppliedFix> {
  if (strategyId === "archive_proposed_change") {
    throw new Error("Archive strategy requires guided review — not auto-applied.");
  }
  const safeItems: ClassifiedItem[] = finding.files.map((file) => ({
    path: file,
    reason: finding.reason,
    findingId: finding.id,
    findingType: finding.type,
  }));
  const originals = await readSourceMap(rootDir, finding.files);
  const { patch, deletedPaths } = await generateUnifiedDeletePatch(rootDir, safeItems);
  const modifiedSources: Record<string, string> = {};
  for (const p of deletedPaths) modifiedSources[p] = "";
  return {
    pluginId: "remove_temp_file",
    strategyId,
    unifiedDiff: patch,
    changedPaths: deletedPaths,
    originalSources: originals,
    modifiedSources,
    expectedFix: `Delete ${deletedPaths.join(", ")}`,
  };
}

async function applyRemoveUnusedImport(
  rootDir: string,
  finding: Finding,
  strategyId: string
): Promise<AppliedFix> {
  const rel = finding.files[0];
  if (!rel) throw new Error("No file for unused import fix.");

  const importLine =
    finding.evidence.signals.find((s) => s.startsWith("importLine="))?.slice(11) ??
    finding.evidence.summary;
  const symbol =
    finding.evidence.signals.find((s) => s.startsWith("symbol="))?.slice(7) ?? "";
  const lineRaw = finding.evidence.signals.find((s) => s.startsWith("line="))?.slice(5);
  const lineNumber = lineRaw ? Number(lineRaw) : undefined;

  const full = path.join(rootDir, rel);
  const original = await fs.readFile(full, "utf8");
  let modified: string;

  switch (strategyId) {
    case "convert_to_type_only_import":
      modified = convertSymbolToTypeOnlyImport(original, importLine, symbol);
      break;
    case "remove_entire_import_when_no_specifiers_remain_and_side_effect_free": {
      const partial = removeUnusedSymbolFromImport(original, importLine, symbol);
      if (partial === original) {
        throw new Error("transform_noop: Unused symbol not present in import declaration.");
      }
      modified = partial;
      break;
    }
    case "remove_unused_named_specifier":
    default:
      modified = removeUnusedSymbolFromImport(original, importLine, symbol);
      if (modified === original && Number.isFinite(lineNumber)) {
        const atLine = removeUnusedSymbolAtLine(original, lineNumber!, symbol);
        if (atLine) modified = atLine;
      }
      break;
  }

  if (modified === original) {
    throw new Error("transform_noop: Unused import could not be modified safely for this strategy.");
  }

  await ensureGitBaseline(rootDir);
  await fs.writeFile(full, modified, "utf8");
  const persisted = await fs.readFile(full, "utf8");
  let diff = await gitDiff(rootDir, [rel]);
  if (!diff.trim() && modified !== original) {
    diff = buildTextDiff(rel, original, modified);
    if (!diff.endsWith("\n")) diff = `${diff}\n`;
  }

  const invariant = validateTransformInvariants({
    originalSource: original,
    transformedSource: modified,
    persistedSource: persisted,
    unifiedDiff: diff,
    changedFiles: [rel],
    findingPath: rel,
    workspacePathInsideRoot: full.startsWith(path.resolve(rootDir)),
  });

  if (!invariant.ok) {
    throw new Error(`${invariant.engineStatus}: ${invariant.blocker}`);
  }

  const generatedChange = {
    originalSource: original,
    modifiedSource: modified,
    originalHash: invariant.record.originalHash,
    modifiedHash: invariant.record.transformedHash,
    unifiedDiff: diff,
  };

  return {
    pluginId: "remove_unused_import",
    strategyId,
    unifiedDiff: diff,
    changedPaths: [rel],
    originalSources: { [rel]: original },
    modifiedSources: { [rel]: modified },
    expectedFix: `Remove unused import from ${rel} (${strategyId})`,
    generatedChange,
    transformAudit: {
      projectRoot: rootDir,
      findingId: finding.id,
      findingPath: rel,
      absoluteWorkspacePath: full,
      pluginId: "remove_unused_import",
      strategyId,
      originalHash: invariant.record.originalHash,
      transformedHash: invariant.record.transformedHash,
      persistedHash: invariant.record.persistedHash,
      sourceChanged: invariant.record.sourceChanged,
      changedFiles: [rel],
      unifiedDiff: diff,
      additions: invariant.record.additions,
      deletions: invariant.record.deletions,
      engineStatus: invariant.record.engineStatus,
    },
  };
}

async function applyRemoveUnusedDependency(
  rootDir: string,
  finding: Finding,
  strategyId: string
): Promise<AppliedFix> {
  const pkgName = finding.packageName;
  if (!pkgName) throw new Error("No package name for dependency fix.");

  const pkgPath = path.join(rootDir, "package.json");
  const original = await fs.readFile(pkgPath, "utf8");
  const pkg = JSON.parse(original) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  let removed = false;
  if (strategyId === "remove_from_dev_dependencies") {
    if (pkg.devDependencies?.[pkgName]) {
      delete pkg.devDependencies[pkgName];
      removed = true;
    }
  } else if (pkg.dependencies?.[pkgName]) {
    delete pkg.dependencies[pkgName];
    removed = true;
  } else if (pkg.devDependencies?.[pkgName]) {
    delete pkg.devDependencies[pkgName];
    removed = true;
  }

  if (!removed) throw new Error(`Package ${pkgName} not found in package.json for ${strategyId}.`);

  await ensureGitBaseline(rootDir);

  const modified = `${JSON.stringify(pkg, null, 2)}\n`;
  await fs.writeFile(pkgPath, modified, "utf8");

  const pm = (await detectPackageManager(rootDir)).packageManager;
  const install = uninstallCommand(pm, pkgName);
  await execa(install[0], install.slice(1), {
    cwd: rootDir,
    timeout: 120_000,
    reject: false,
    env: { ...process.env, CI: "true" },
  });

  const changedPaths = ["package.json"];
  const lockfiles = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb"];
  for (const lf of lockfiles) {
    try {
      await fs.access(path.join(rootDir, lf));
      changedPaths.push(lf);
    } catch {
      /* absent */
    }
  }

  const diff = await gitDiff(rootDir);
  const modifiedSources: Record<string, string> = { "package.json": modified };
  for (const lf of changedPaths.slice(1)) {
    try {
      modifiedSources[lf] = await fs.readFile(path.join(rootDir, lf), "utf8");
    } catch {
      modifiedSources[lf] = "";
    }
  }

  return {
    pluginId: "remove_unused_dependency",
    strategyId,
    unifiedDiff: diff,
    changedPaths,
    originalSources: { "package.json": original },
    modifiedSources,
    expectedFix: `Remove unused dependency ${pkgName} (${strategyId})`,
  };
}

export async function applyPhase1Fix(
  rootDir: string,
  finding: Finding,
  strategyId?: string
): Promise<AppliedFix> {
  const plugin = resolvePhase1TransformPlugin(finding);
  const resolvedStrategy =
    strategyId ?? defaultStrategyForPlugin(plugin.id)?.id ?? "default";

  switch (plugin.id) {
    case "remove_temp_file":
      return applyRemoveTempFile(rootDir, finding, resolvedStrategy);
    case "remove_unused_import":
      return applyRemoveUnusedImport(rootDir, finding, resolvedStrategy);
    case "remove_unused_dependency":
      return applyRemoveUnusedDependency(rootDir, finding, resolvedStrategy);
    default:
      throw new Error(`Plugin ${plugin.id} cannot apply automatic changes.`);
  }
}
