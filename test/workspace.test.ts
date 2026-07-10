/**
 * Workspace + runtime path tests (offline).
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createScanWorkspace,
  getRuntimeRoot,
  removeWorkspace,
} from "../src/lib/server/workspace";
import { isServerlessRuntime } from "../src/lib/server/runtime-env";
import { unzipRepoToDir } from "../src/lib/scanner/unzip-repo";
import JSZip from "jszip";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

function test(name: string, fn: () => Promise<void>) {
  return (async () => {
    await fn();
    console.log(`  ✓ ${name}`);
  })();
}

async function run() {
  console.log("RepoDiet workspace tests");

  const prevVercel = process.env.VERCEL;
  const prevLambda = process.env.AWS_LAMBDA_FUNCTION_NAME;

  await test("production runtime resolves workspace under os.tmpdir()", async () => {
    process.env.VERCEL = "1";
    process.env.AWS_LAMBDA_FUNCTION_NAME = "test-fn";
    const workspace = await createScanWorkspace("scan");
    assert.ok(workspace.root.startsWith(os.tmpdir()));
    assert.ok(workspace.root.includes("repodiet"));
    await removeWorkspace(workspace.root);
  });

  await test("local runtime resolves to .repodiet-runtime when not serverless", async () => {
    delete process.env.VERCEL;
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    if (!process.cwd().startsWith("/var/task")) {
      const root = getRuntimeRoot();
      assert.ok(root.endsWith(".repodiet-runtime"));
    } else {
      assert.ok(isServerlessRuntime());
    }
  });

  await test("unique requests receive different folders", async () => {
    process.env.VERCEL = "1";
    const a = await createScanWorkspace("scan");
    const b = await createScanWorkspace("scan");
    assert.notEqual(a.root, b.root);
    await removeWorkspace(a.root);
    await removeWorkspace(b.root);
  });

  await test("cleanup refuses paths outside runtime root", async () => {
    process.env.VERCEL = "1";
    const outside = path.join(os.tmpdir(), "repodiet-outside-test");
    await fs.mkdir(outside, { recursive: true });
    await assert.rejects(
      () => removeWorkspace(outside),
      /Refusing to remove path outside RepoDiet runtime root/
    );
    await fs.rm(outside, { recursive: true, force: true });
  });

  await test("scanner prepare-workspace never mkdir under /var/task", async () => {
    const source = await fs.readFile(
      path.join(ROOT, "src/lib/scanner/prepare-workspace.ts"),
      "utf8"
    );
    assert.doesNotMatch(source, /process\.cwd\(\)/);
    assert.doesNotMatch(source, /\/var\/task/);
    assert.match(source, /createScanWorkspace/);
  });

  await test("ZIP extraction receives explicit destination", async () => {
    process.env.VERCEL = "1";
    const workspace = await createScanWorkspace("zip");
    const zip = new JSZip();
    zip.file("repo-main/readme.md", "# hello");
    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const rootDir = await unzipRepoToDir(buffer, workspace.extractPath);
    assert.ok(rootDir.startsWith(workspace.extractPath));
    await removeWorkspace(workspace.root);
  });

  await test("analyzer reports write only within the workspace", async () => {
    process.env.VERCEL = "1";
    const workspace = await createScanWorkspace("reports");
    const reportFile = path.join(workspace.reportsPath, "knip.json");
    await fs.writeFile(reportFile, "{}", "utf8");
    assert.ok(reportFile.startsWith(workspace.root));
    await removeWorkspace(workspace.root);
    await assert.rejects(() => fs.access(reportFile));
  });

  await test("finally cleanup occurs after success", async () => {
    process.env.VERCEL = "1";
    let workspaceRoot = "";
    try {
      const workspace = await createScanWorkspace("success");
      workspaceRoot = workspace.root;
      await fs.writeFile(path.join(workspace.root, "marker.txt"), "ok", "utf8");
    } finally {
      if (workspaceRoot) await removeWorkspace(workspaceRoot);
    }
    await assert.rejects(() => fs.access(workspaceRoot));
  });

  await test("finally cleanup occurs after failure", async () => {
    process.env.VERCEL = "1";
    let workspaceRoot = "";
    try {
      const workspace = await createScanWorkspace("failure");
      workspaceRoot = workspace.root;
      throw new Error("simulated failure");
    } catch (err) {
      assert.equal((err as Error).message, "simulated failure");
    } finally {
      if (workspaceRoot) await removeWorkspace(workspaceRoot);
    }
    await assert.rejects(() => fs.access(workspaceRoot));
  });

  await test("durable store avoids project-root data on serverless", async () => {
    const source = await fs.readFile(
      path.join(ROOT, "src/lib/store/durable-store.ts"),
      "utf8"
    );
    assert.doesNotMatch(source, /path\.join\(process\.cwd\(\), "data"\)/);
    const runtimeSource = await fs.readFile(
      path.join(ROOT, "src/lib/server/runtime-env.ts"),
      "utf8"
    );
    assert.match(runtimeSource, /isServerlessRuntime/);
    assert.match(runtimeSource, /UPSTASH_REDIS_REST_URL/);
  });

  process.env.VERCEL = prevVercel;
  process.env.AWS_LAMBDA_FUNCTION_NAME = prevLambda;

  console.log("\nAll workspace tests passed.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
