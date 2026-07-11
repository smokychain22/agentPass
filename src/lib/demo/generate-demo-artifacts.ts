import fs from "node:fs/promises";
import path from "node:path";
import { DEMO_REPO_URL } from "./constants";
import { getDemoBundlePath, getDemoStatsPath } from "./paths";
import { runBasicScan } from "@/lib/scanner/run-scan";
import { runFindingsEngine } from "@/lib/findings/findings-engine";
import { runPatchKitEngine } from "@/lib/patch-kit/patch-kit-engine";
import { classifyFindingsForPatch } from "@/lib/patch-kit/safe-delete-classifier";

export interface DemoScanStats {
  generatedAt: string;
  repoUrl: string;
  framework: string;
  packageManager: string;
  filesIndexed: number;
  duplicateClusters: number;
  unusedFiles: number;
  unusedDependencies: number;
  orphanPatterns: number;
  aiSlopSignals: number;
  safeCandidates: number;
  reviewFirst: number;
  doNotTouch: number;
  patchBundleReady: boolean;
}

const STATS_PATH = getDemoStatsPath();
const BUNDLE_PATH = getDemoBundlePath();

export { getDemoStatsPath, getDemoBundlePath } from "./paths";

export async function readDemoScanStats(): Promise<DemoScanStats | null> {
  try {
    const raw = await fs.readFile(STATS_PATH, "utf8");
    return JSON.parse(raw) as DemoScanStats;
  } catch {
    return null;
  }
}

export async function generateDemoArtifacts(): Promise<{
  stats: DemoScanStats;
  bundlePath: string;
}> {
  const scan = await runBasicScan(DEMO_REPO_URL);
  const findings = await runFindingsEngine(DEMO_REPO_URL);
  const buckets = classifyFindingsForPatch(findings);
  const patchKit = await runPatchKitEngine({ repoUrl: DEMO_REPO_URL });

  const stats: DemoScanStats = {
    generatedAt: new Date().toISOString(),
    repoUrl: DEMO_REPO_URL,
    framework: scan.framework.name,
    packageManager: scan.packageManager,
    filesIndexed: scan.summary.totalFiles,
    duplicateClusters: findings.summary.duplicateClusters,
    unusedFiles: findings.unused.files.length,
    unusedDependencies: findings.unused.dependencies.length,
    orphanPatterns: findings.orphans.length,
    aiSlopSignals: findings.slopSignals.length,
    safeCandidates: buckets.safeDelete.length,
    reviewFirst: buckets.reviewFirst.length,
    doNotTouch: buckets.doNotTouch.length,
    patchBundleReady: true,
  };

  await fs.mkdir(path.dirname(STATS_PATH), { recursive: true });
  await fs.writeFile(STATS_PATH, JSON.stringify(stats, null, 2) + "\n");

  await fs.mkdir(path.dirname(BUNDLE_PATH), { recursive: true });
  const zipBuffer = Buffer.from(patchKit.zipBase64!, "base64");
  await fs.writeFile(BUNDLE_PATH, zipBuffer);

  return { stats, bundlePath: BUNDLE_PATH };
}

export async function ensureDemoArtifacts(): Promise<DemoScanStats> {
  const existing = await readDemoScanStats();
  try {
    await fs.access(BUNDLE_PATH);
    if (existing) return existing;
  } catch {
    /* generate below */
  }
  const { stats } = await generateDemoArtifacts();
  return stats;
}
