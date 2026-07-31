/**
 * src/lib/okx-runtime/plugin-inspection.ts — parses `openclaw plugins
 * inspect <id> --runtime --json` output.
 *
 * Runtime boot-time and on-demand readiness checks no longer spawn this
 * CLI command at all (see Incident #8, src/lib/okx-runtime/plugin-
 * activation-proof.ts's module docblock — proven live to starve the
 * Gateway's CPU on repodiet-agent-9636's shared vCPU). parsePluginInspection
 * itself is still real production code, though: scripts/verify-openclaw-
 * plugins-load.ts's Dockerfile.seller BUILD-TIME check still calls the CLI
 * directly and parses its output with this same function — a fresh,
 * single-process `docker build` step with no live Gateway process
 * contending for CPU, a fundamentally different execution context from
 * Incident #8's boot-time/on-demand hang. These tests were previously
 * exercised indirectly via scripts/seller-runtime-supervisor.ts's
 * parseBridgePluginInspection re-export before that re-export was removed
 * as part of the Incident #8 fix; moved here so parsePluginInspection
 * keeps direct test coverage independent of that removal.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { parsePluginInspection } from "../src/lib/okx-runtime/plugin-inspection";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

const REPO_ROOT = path.resolve(__dirname, "..");
const FIXTURE_PATH = path.join(REPO_ROOT, "test", "fixtures", "openclaw-plugins-inspect-repodiet-a2a-bridge.real-output.json");
const PLUGIN_ID = "repodiet-a2a-bridge";
const HOOK_NAME = "before_agent_reply";

test("parsePluginInspection accepts the real captured fixture: status=loaded, activated=true, before_agent_reply registered", () => {
  const fixture = fs.readFileSync(FIXTURE_PATH, "utf8");
  assert.equal(parsePluginInspection(fixture, PLUGIN_ID, HOOK_NAME), true);
  const parsed = JSON.parse(fixture);
  assert.equal(parsed.plugin.status, "loaded");
  assert.equal(parsed.plugin.activated, true);
  assert.equal(parsed.shape, "hook-only");
  assert.deepEqual(parsed.typedHooks, [{ name: "before_agent_reply" }]);
});

test("parsePluginInspection rejects a plugin that is present but not activated", () => {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
  fixture.plugin.activated = false;
  fixture.plugin.status = "blocked";
  assert.equal(parsePluginInspection(JSON.stringify(fixture), PLUGIN_ID, HOOK_NAME), false);
});

test("parsePluginInspection rejects output where the hook did not actually register", () => {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
  fixture.typedHooks = [];
  fixture.hookCount = 0;
  assert.equal(parsePluginInspection(JSON.stringify(fixture), PLUGIN_ID, HOOK_NAME), false);
});

test("parsePluginInspection rejects unparseable output instead of defaulting to true", () => {
  assert.equal(parsePluginInspection("not json", PLUGIN_ID, HOOK_NAME), false);
  assert.equal(parsePluginInspection("", PLUGIN_ID, HOOK_NAME), false);
});

test("parsePluginInspection rejects a plugin id mismatch — the id must actually match, not just appear somewhere in output", () => {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
  fixture.plugin.id = "some-other-plugin";
  assert.equal(parsePluginInspection(JSON.stringify(fixture), PLUGIN_ID, HOOK_NAME), false);
});

test("parsePluginInspection rejects a required hook name that was never registered, even when other hooks were", () => {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
  assert.equal(parsePluginInspection(JSON.stringify(fixture), PLUGIN_ID, "some_other_hook"), false);
});

console.log("plugin-inspection: all passed");
