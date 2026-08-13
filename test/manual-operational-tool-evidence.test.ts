import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { searchCounterEvidence } from "../src/lib/evidence/counter-evidence";
import type { Finding } from "../src/lib/findings/types";

/**
 * Regression for a real false positive found against velz-cmd/Meridian.
 *
 * `scripts/sync-vercel-env.mjs` was bucketed as safeDelete because nothing
 * imports it — which is true of every manually invoked operational script by
 * construction. It documents its own usage and has a `.ps1` sibling that a
 * deployment runbook tells operators to run, so deleting it would have removed
 * a working tool from a customer's repository during a paid cleanup.
 *
 * These tests pin BOTH directions: the manual-use signals must contradict a
 * delete recommendation, and a genuinely unreferenced probe script must still
 * remain a candidate. A fix that simply suppressed everything under `scripts/`
 * would pass the first three cases and fail Case D.
 */

let tmpRoot = "";

function unusedFileFinding(file: string): Finding {
  return {
    id: `fnd_${file.replace(/[^a-z0-9]/gi, "_")}`,
    type: "unused_file",
    title: "Unused file",
    severity: "medium",
    action: "safe_candidate",
    confidence: 0.76,
    files: [file],
    reason: "File is not referenced by import graph or framework entry points.",
    evidence: { summary: "Unused file candidate", signals: [] },
  } as unknown as Finding;
}

async function write(rel: string, content: string) {
  const full = path.join(tmpRoot, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf8");
}

async function contradictingFor(file: string) {
  const { items } = await searchCounterEvidence({
    finding: unusedFileFinding(file),
    rootDir: tmpRoot,
  });
  return items.filter((i) => i.strength === "contradicting");
}

function test(name: string, fn: () => Promise<void>) {
  return (async () => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      console.error(`  ✗ ${name}`);
      throw err;
    }
  })();
}

async function run() {
  console.log("manual-operational-tool-evidence");

  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-manual-tool-"));
  await write("package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));

  // Case A — manual CLI script: documents its own usage, nothing imports it.
  await write(
    "scripts/example.mjs",
    `/**\n * Sync things.\n * Usage: node scripts/example.mjs\n */\nexport {};\n`
  );

  // Case B — platform sibling pair.
  await write("scripts/sync-env.mjs", "export {};\n");
  await write("scripts/sync-env.ps1", "Write-Output 'sync'\n");

  // Case C — a shell script referencing another file.
  await write("scripts/referenced-by-shell.mjs", "export {};\n");
  await write("scripts/deploy.sh", "#!/usr/bin/env bash\nnode scripts/referenced-by-shell.mjs\n");

  // Case D — genuinely unused probe: no usage header, no sibling, no references.
  await write("scripts/probe-thing.mjs", "const x = 1;\nexport default x;\n");

  await test("Case A — a self-documented Usage: header contradicts deletion", async () => {
    const items = await contradictingFor("scripts/example.mjs");
    assert.ok(
      items.some((i) => i.source === "usage_header"),
      `expected usage_header evidence, got: ${JSON.stringify(items)}`
    );
  });

  await test("Case B — a platform sibling script contradicts deletion", async () => {
    const items = await contradictingFor("scripts/sync-env.mjs");
    assert.ok(
      items.some((i) => i.source === "platform_sibling"),
      `expected platform_sibling evidence, got: ${JSON.stringify(items)}`
    );
  });

  await test("Case C — a reference from a shell script is detected", async () => {
    const { items } = await searchCounterEvidence({
      finding: unusedFileFinding("scripts/referenced-by-shell.mjs"),
      rootDir: tmpRoot,
    });
    assert.ok(
      items.length > 0,
      "a .sh reference must surface as counter-evidence, not be invisible"
    );
  });

  await test("Case D — a genuinely unused probe stays a delete candidate", async () => {
    const items = await contradictingFor("scripts/probe-thing.mjs");
    assert.equal(
      items.length,
      0,
      `no contradiction expected for an unreferenced probe, got: ${JSON.stringify(items)}`
    );
  });

  await test("a shebang marks a file as directly executable", async () => {
    await write("scripts/runnable.mjs", "#!/usr/bin/env node\nexport {};\n");
    const items = await contradictingFor("scripts/runnable.mjs");
    assert.ok(
      items.some((i) => i.source === "shebang"),
      `expected shebang evidence, got: ${JSON.stringify(items)}`
    );
  });

  await test("signals are evidence, not a permanent veto — they contradict, never 'protected'", async () => {
    const items = await contradictingFor("scripts/example.mjs");
    // The decision matrix weighs contradicting evidence; it must not be
    // upgraded into an absolute do-not-touch, or overwhelming later proof of
    // obsolescence could never remove the file.
    assert.ok(items.every((i) => i.strength === "contradicting"));
    assert.ok(items.every((i) => i.channel === "script"));
  });

  await fs.rm(tmpRoot, { recursive: true, force: true });
  console.log("manual-operational-tool-evidence: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
