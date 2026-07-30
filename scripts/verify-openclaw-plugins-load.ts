#!/usr/bin/env tsx
/**
 * Build-time-only smoke test, run from Dockerfile.seller: proves both
 * OpenClaw plugins baked into this image actually load and activate,
 * instead of only discovering a missing runtime dependency live in
 * production. Root cause of the incident this exists for:
 * @okxweb3/a2a-openclaw declares a real runtime dependency on
 * @sentry/node, which this image never installed — the plugin's own
 * dist/index.js failed with "Cannot find module '@sentry/node'" only once
 * the Gateway actually tried to load it live on repodiet-agent-9636,
 * well after the build had already succeeded. See
 * docs/SELLER_RUNTIME_DEPLOYMENT.md ("Incident #5") for the full writeup.
 *
 * Reuses the exact batch/plugin ids/hooks scripts/seller-runtime-
 * supervisor.ts configures and verifies at boot, so this can never
 * silently drift from what actually ships — it is not a second,
 * hand-maintained copy of that logic.
 *
 * Run under a scratch HOME and a placeholder gateway token, both confined
 * to the one Dockerfile RUN layer that invokes this script via inline env
 * assignment — never a Dockerfile ENV, so nothing here is ever baked into
 * the image's persisted environment or the real runtime's HOME.
 */
import { execFileSync } from "node:child_process";
import {
  buildOpenclawConfigBatch,
  OKX_A2A_PLUGIN_ID,
  OKX_A2A_PLUGIN_HOOK,
  REPODIET_BRIDGE_PLUGIN_ID,
  REPODIET_BRIDGE_PLUGIN_HOOK,
} from "./seller-runtime-supervisor";
import { parsePluginInspection } from "../src/lib/okx-runtime/plugin-inspection";

function fail(message: string): never {
  console.error(`[verify-openclaw-plugins-load] FAILED: ${message}`);
  process.exit(1);
}

const batch = buildOpenclawConfigBatch();
execFileSync("openclaw", ["config", "set", "--batch-json", JSON.stringify(batch), "--strict-json"], {
  stdio: "inherit",
});

const pluginsToVerify: ReadonlyArray<readonly [string, string]> = [
  [OKX_A2A_PLUGIN_ID, OKX_A2A_PLUGIN_HOOK],
  [REPODIET_BRIDGE_PLUGIN_ID, REPODIET_BRIDGE_PLUGIN_HOOK],
];

for (const [id, hook] of pluginsToVerify) {
  const stdout = execFileSync("openclaw", ["plugins", "inspect", id, "--runtime", "--json"], { encoding: "utf8" });
  if (!parsePluginInspection(stdout, id, hook)) {
    fail(`plugin "${id}" did not report loaded+activated with hook "${hook}" — build-time output:\n${stdout}`);
  }
  console.log(`[verify-openclaw-plugins-load] OK: ${id} loaded and activated with hook "${hook}"`);
}
