#!/usr/bin/env tsx
/**
 * Verify native Knip on velz-cmd/Meridian (OOM fix: KNIP_DISABLE_RAW_TRANSFER=1).
 * Usage: npm run test:meridian-knip
 */
import { prepareRepoWorkspace } from "../src/lib/scanner/prepare-workspace";
import { runKnip } from "../src/lib/findings/run-knip";

const MERIDIAN = process.env.REPODIET_MERIDIAN_URL ?? "https://github.com/velz-cmd/Meridian";

async function main() {
  console.log(`Meridian Knip smoke: ${MERIDIAN}`);
  const workspace = await prepareRepoWorkspace(MERIDIAN);
  try {
    const started = Date.now();
    const result = await runKnip(workspace.rootDir);
    const durationMs = Date.now() - started;
    console.log(
      JSON.stringify(
        {
          status: result.status,
          sourceMode: result.sourceMode,
          version: result.version,
          durationMs,
          issueCount: result.report?.issues?.length ?? 0,
          error: result.error ? result.error.split("\n").slice(0, 5).join("\n") : undefined,
        },
        null,
        2
      )
    );
    if (result.status !== "ok" || result.sourceMode !== "native") {
      console.error("FAIL: Knip did not complete natively on Meridian.");
      process.exit(1);
    }
    console.log("PASS: Native Knip on Meridian");
  } finally {
    await workspace.cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
