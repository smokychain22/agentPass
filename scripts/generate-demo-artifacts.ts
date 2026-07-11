/**
 * Generates demo scan stats and sample bundle from the seeded demo repo.
 * Run: npx tsx scripts/generate-demo-artifacts.ts
 */
import fs from "node:fs/promises";
import path from "node:path";
import { DEMO_REPO_URL } from "../src/lib/demo/constants";
import { runBasicScan } from "../src/lib/scanner/run-scan";
import { runFindingsEngine } from "../src/lib/findings/findings-engine";
import { runPatchKitEngine } from "../src/lib/patch-kit/patch-kit-engine";
import { classifyFindingsForPatch } from "../src/lib/patch-kit/safe-delete-classifier";

async function main() {
  console.log("Scanning demo repo...");
  const scan = await runBasicScan(DEMO_REPO_URL);

  console.log("Running findings engine...");
  const findings = await runFindingsEngine(DEMO_REPO_URL);

  const buckets = classifyFindingsForPatch(findings);

  const stats = {
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

  console.log("Generating patch kit bundle...");
  const patchKit = await runPatchKitEngine({ repoUrl: DEMO_REPO_URL });

  const statsPath = path.join(process.cwd(), "src/lib/demo/scan-stats.json");
  await fs.writeFile(statsPath, JSON.stringify(stats, null, 2) + "\n");
  console.log(`Wrote ${statsPath}`);
  console.log(JSON.stringify(stats, null, 2));

  const bundleDir = path.join(process.cwd(), "public/demo");
  await fs.mkdir(bundleDir, { recursive: true });
  const bundlePath = path.join(bundleDir, "repodiet-demo-sample-bundle.zip");
  const zipBuffer = Buffer.from(patchKit.zipBase64!, "base64");
  await fs.writeFile(bundlePath, zipBuffer);
  console.log(`Wrote ${bundlePath} (${zipBuffer.byteLength} bytes)`);

  const hasDeleteOps = patchKit.artifacts.cleanupPatch.includes("git rm ");
  console.log(`Cleanup patch has safe delete commands: ${hasDeleteOps}`);
  console.log(`Safe delete paths: ${buckets.safeDelete.map((b) => b.path).join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
