import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { createHash } from "node:crypto";
import type { Finding } from "@/lib/findings/types";
import { generateUnifiedDeletePatch } from "@/lib/patch-kit/generate-unified-diff";
import type { ClassifiedItem } from "@/lib/patch-kit/types";
import {
  findFilesImporting,
  findModuleReferences,
  moduleSpecifierTargetsFile,
} from "../reference-graph";
import { buildTextDiff } from "../fix-preflight";
import type { AppliedFix } from "./apply-phase1-fix";
import type { Phase1PluginId } from "./phase1-plugins";

function signalValue(finding: Finding, prefix: string): string | undefined {
  return finding.evidence.signals.find((s) => s.startsWith(prefix))?.slice(prefix.length);
}

function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16);
}

async function ensureGitBaseline(rootDir: string): Promise<void> {
  await execa("git", ["init"], { cwd: rootDir, reject: false });
  await execa("git", ["add", "-A"], { cwd: rootDir, reject: false });
  await execa(
    "git",
    ["-c", "user.email=repodiet@local", "-c", "user.name=RepoDiet", "commit", "-m", "baseline", "--allow-empty"],
    { cwd: rootDir, reject: false }
  );
}

async function gitDiff(rootDir: string): Promise<string> {
  const diff = await execa("git", ["diff", "--no-color", "HEAD"], { cwd: rootDir, reject: false });
  const out = diff.stdout ?? "";
  if (!out.trim()) return "";
  return out.endsWith("\n") ? out : `${out}\n`;
}

function rewriteImportsToCanonical(
  source: string,
  duplicateRel: string,
  canonicalRel: string,
  importerFile: string
): string {
  const importerDir = path.posix.dirname(importerFile.replace(/\\/g, "/"));
  const toCanonical = path.posix.relative(importerDir, canonicalRel.replace(/\\/g, "/"));
  const importTarget = toCanonical.startsWith(".") ? toCanonical : `./${toCanonical}`;
  const normalizedImport = importTarget.replace(/\.(tsx?|jsx?|mjs|cjs)$/i, "");

  let next = source;
  const references = findModuleReferences(source)
    .filter((reference) =>
      moduleSpecifierTargetsFile(importerFile, reference.specifier, duplicateRel)
    )
    .sort((left, right) => right.start - left.start);
  for (const reference of references) {
    next = `${next.slice(0, reference.start)}${normalizedImport}${next.slice(reference.end)}`;
  }
  return next;
}

export async function applyRemoveEmptyFile(
  rootDir: string,
  finding: Finding,
  strategyId: string
): Promise<AppliedFix> {
  return applyDeleteFile(rootDir, finding, strategyId, "remove_empty_file");
}

export async function applyRemoveConfirmedUnusedFile(
  rootDir: string,
  finding: Finding,
  strategyId: string
): Promise<AppliedFix> {
  return applyDeleteFile(rootDir, finding, strategyId, "remove_confirmed_unused_file");
}

async function applyDeleteFile(
  rootDir: string,
  finding: Finding,
  strategyId: string,
  pluginId: Phase1PluginId
): Promise<AppliedFix> {
  if (strategyId === "archive_proposed_change") {
    throw new Error("Archive strategy requires guided review — not auto-applied.");
  }
  const rel = finding.files[0];
  if (!rel) throw new Error("No file path for deletion.");

  const inbound = signalValue(finding, "inbound_refs=");
  if (inbound && Number(inbound) > 0) {
    throw new Error("transform_noop: File still has inbound references.");
  }

  const safeItems: ClassifiedItem[] = [
    {
      path: rel,
      reason: finding.reason,
      findingId: finding.id,
      findingType: finding.type,
    },
  ];
  const originals: Record<string, string> = {};
  try {
    originals[rel] = await fs.readFile(path.join(rootDir, rel), "utf8");
  } catch {
    originals[rel] = "";
  }

  const { patch, deletedPaths } = await generateUnifiedDeletePatch(rootDir, safeItems);
  if (!patch.trim() || deletedPaths.length === 0) {
    throw new Error("diff_generation_failed: Delete patch was empty.");
  }

  return {
    pluginId,
    strategyId,
    unifiedDiff: patch,
    changedPaths: deletedPaths,
    originalSources: originals,
    modifiedSources: { [rel]: "" },
    expectedFix: `Delete ${rel}`,
  };
}

export async function applyConsolidateExactDuplicate(
  rootDir: string,
  finding: Finding,
  strategyId: string
): Promise<AppliedFix> {
  const canonical = signalValue(finding, "canonical=");
  const duplicate = signalValue(finding, "duplicate=");
  const expectedHash = signalValue(finding, "content_hash=");
  if (!canonical || !duplicate) {
    throw new Error("plugin_strategy_missing: Missing canonical/duplicate paths.");
  }

  const canonicalFull = path.join(rootDir, canonical);
  const duplicateFull = path.join(rootDir, duplicate);
  const canonicalSource = await fs.readFile(canonicalFull, "utf8");
  const duplicateSource = await fs.readFile(duplicateFull, "utf8");

  const canonicalHash = hashContent(canonicalSource);
  const duplicateHash = hashContent(duplicateSource);
  if (canonicalHash !== duplicateHash) {
    throw new Error("source_hash_mismatch: Files are not exact duplicates.");
  }
  if (expectedHash && canonicalHash !== expectedHash) {
    throw new Error("stale_snapshot: Content hash does not match scan evidence.");
  }

  await ensureGitBaseline(rootDir);

  const importers = await findFilesImporting(rootDir, duplicate);
  const changedPaths = new Set<string>();
  const originalSources: Record<string, string> = {
    [canonical]: canonicalSource,
    [duplicate]: duplicateSource,
  };
  const modifiedSources: Record<string, string> = {};

  for (const hit of importers) {
    const full = path.join(rootDir, hit.file);
    const original = await fs.readFile(full, "utf8");
    const modified = rewriteImportsToCanonical(original, duplicate, canonical, hit.file);
    if (modified !== original) {
      await fs.writeFile(full, modified, "utf8");
      originalSources[hit.file] = original;
      modifiedSources[hit.file] = modified;
      changedPaths.add(hit.file);
    }
  }

  const unresolvedImporters = await findFilesImporting(rootDir, duplicate);
  if (unresolvedImporters.length > 0) {
    throw new Error(
      `import_rewrite_failed: ${unresolvedImporters.map((hit) => hit.file).join(", ")}`
    );
  }

  await fs.unlink(duplicateFull);
  modifiedSources[duplicate] = "";
  changedPaths.add(duplicate);

  let diff = await gitDiff(rootDir);
  if (!diff.trim()) {
    const parts: string[] = [];
    for (const [rel, original] of Object.entries(originalSources)) {
      const modified = modifiedSources[rel];
      if (modified !== undefined && modified !== original) {
        parts.push(buildTextDiff(rel, original, modified));
      }
    }
    if (modifiedSources[duplicate] === "") {
      parts.push(buildTextDiff(duplicate, duplicateSource, ""));
    }
    diff = parts.filter(Boolean).join("\n");
    if (diff && !diff.endsWith("\n")) diff = `${diff}\n`;
  }

  if (!diff.trim()) {
    throw new Error("diff_generation_failed: Unified diff is empty.");
  }

  return {
    pluginId: "consolidate_exact_duplicate",
    strategyId,
    unifiedDiff: diff,
    changedPaths: [...changedPaths],
    originalSources,
    modifiedSources,
    expectedFix: `Consolidate ${duplicate} into ${canonical}`,
  };
}
