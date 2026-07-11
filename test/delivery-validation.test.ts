import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compareBaselineToAfter, runFullBaselineChecks } from "../src/lib/execution/baseline-verification";
import { isWorkspaceDependencyReady } from "../src/lib/execution/workspace-install";
import { validateEditsForDelivery } from "../src/lib/patch-kit/validate-patch";

function test(name: string, fn: () => void | Promise<void>) {
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
  console.log("Delivery validation tests");

  await test("runFullBaselineChecks can skip package integrity", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-skip-pkg-"));
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "demo", scripts: {} }, null, 2)
    );
    const checks = await runFullBaselineChecks(root, "baseline", { skipPackageIntegrity: true });
    assert.equal(checks.some((c) => c.name === "package integrity"), false);
    await fs.rm(root, { recursive: true, force: true });
  });

  await test("compareBaselineToAfter ignores package integrity drift", () => {
    const baseline = [
      {
        name: "package integrity",
        command: "npm install",
        status: "passed" as const,
        exitCode: 0,
        durationMs: 1,
        stdoutSummary: "",
        stderrSummary: "",
        outcome: "passed" as const,
        phase: "baseline" as const,
      },
    ];
    const after = [
      {
        name: "package integrity",
        command: "npm install",
        status: "failed" as const,
        exitCode: 1,
        durationMs: 2,
        stdoutSummary: "",
        stderrSummary: "npm warn tarball seems corrupted",
        outcome: "failed" as const,
        phase: "after" as const,
      },
    ];
    const compared = compareBaselineToAfter(baseline, after);
    assert.equal(compared[0]?.outcome, "new_failure_introduced");
  });

  await test("validateEditsForDelivery passes simple TypeScript edit without package integrity rerun", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-validate-"));
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify(
        {
          name: "fixture",
          scripts: { typecheck: "tsc --noEmit" },
          devDependencies: { typescript: "^5.8.3" },
        },
        null,
        2
      )
    );
    await fs.writeFile(
      path.join(root, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2020",
            module: "ESNext",
            strict: true,
            skipLibCheck: true,
          },
          include: ["src"],
        },
        null,
        2
      )
    );
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(
      path.join(root, "src", "index.ts"),
      'import { unused } from "./unused";\nexport const value = 1;\n',
      "utf8"
    );
    await fs.writeFile(path.join(root, "src", "unused.ts"), "export const unused = true;\n", "utf8");

    const result = await validateEditsForDelivery(root, [
      {
        path: "src/index.ts",
        content: "export const value = 1;\n",
      },
    ]);

    assert.equal(result.status, "passed", result.error);
    await fs.rm(root, { recursive: true, force: true });
  });

  await test("validateEditsForDelivery uses lightweight path when dependencies are unavailable", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-light-"));
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify(
        {
          name: "fixture",
          scripts: { build: "next build", typecheck: "tsc --noEmit" },
        },
        null,
        2
      )
    );
    await fs.writeFile(
      path.join(root, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2020",
            module: "ESNext",
            strict: true,
            skipLibCheck: true,
          },
          include: ["src"],
        },
        null,
        2
      )
    );
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(
      path.join(root, "src", "index.ts"),
      'import { unused } from "./unused";\nexport const value = 1;\n',
      "utf8"
    );

    assert.equal(await isWorkspaceDependencyReady(root), false);

    const result = await validateEditsForDelivery(root, [
      {
        path: "src/index.ts",
        content: "export const value = 1;\n",
      },
    ]);

    assert.equal(result.status, "passed", result.error);
    await fs.rm(root, { recursive: true, force: true });
  });

  console.log("All delivery validation tests passed.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
