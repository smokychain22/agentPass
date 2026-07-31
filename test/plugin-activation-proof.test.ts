/**
 * src/lib/okx-runtime/plugin-activation-proof.ts — the Incident #8
 * replacement for CLI-spawned plugin-activation verification. See that
 * module's docblock for the full live-diagnosed root cause and rationale.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  parseGatewayListeningPluginIds,
  writePluginActivationProof,
  readPluginActivationProof,
  isPluginActivationProven,
  type PluginActivationProof,
} from "../src/lib/okx-runtime/plugin-activation-proof";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

// --- parseGatewayListeningPluginIds ---------------------------------------

test("parses the two-plugin case with a duration suffix", () => {
  assert.deepEqual(
    parseGatewayListeningPluginIds("http server listening (2 plugins: okx-a2a, repodiet-a2a-bridge; 1.2s)"),
    ["okx-a2a", "repodiet-a2a-bridge"]
  );
});

test("parses the two-plugin case with no duration suffix", () => {
  assert.deepEqual(
    parseGatewayListeningPluginIds("http server listening (2 plugins: okx-a2a, repodiet-a2a-bridge)"),
    ["okx-a2a", "repodiet-a2a-bridge"]
  );
});

test("parses the singular 1-plugin case", () => {
  assert.deepEqual(parseGatewayListeningPluginIds("http server listening (1 plugin: okx-a2a)"), ["okx-a2a"]);
});

test("parses the genuine zero-plugins case as an empty array, both with and without a duration suffix", () => {
  assert.deepEqual(parseGatewayListeningPluginIds("http server listening (0 plugins)"), []);
  assert.deepEqual(parseGatewayListeningPluginIds("http server listening (0 plugins, 0.4s)"), []);
});

test("matches anywhere inside a larger buffer (a JSON log line or a rolling stdout tail), not just an exact standalone line", () => {
  assert.deepEqual(
    parseGatewayListeningPluginIds(
      '{"level":"info","msg":"http server listening (2 plugins: okx-a2a, repodiet-a2a-bridge; 1.2s)"}\n'
    ),
    ["okx-a2a", "repodiet-a2a-bridge"]
  );
});

test("returns null (not an empty array) when the line has not appeared at all — so callers can distinguish 'not seen yet' from 'genuinely zero'", () => {
  assert.equal(parseGatewayListeningPluginIds("some unrelated startup log line\n"), null);
  assert.equal(parseGatewayListeningPluginIds("bootstrap_running: config schema unchanged\n"), null);
  assert.equal(parseGatewayListeningPluginIds(""), null);
});

// --- writePluginActivationProof / readPluginActivationProof --------------

function withScratchDir(fn: (proofPath: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-activation-proof-test-"));
  try {
    fn(path.join(dir, "nested", "repodiet-plugin-activation.json"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("writePluginActivationProof creates missing parent directories and readPluginActivationProof reads back an identical round trip", () => {
  withScratchDir((proofPath) => {
    const proof: PluginActivationProof = {
      writtenAt: new Date().toISOString(),
      loadedPluginIds: ["okx-a2a", "repodiet-a2a-bridge"],
      configuredHooks: { "okx-a2a": "before_agent_run", "repodiet-a2a-bridge": "before_agent_reply" },
    };
    writePluginActivationProof(proofPath, proof);
    assert.deepEqual(readPluginActivationProof(proofPath), proof);
  });
});

test("writePluginActivationProof is atomic (write-then-rename) — no stray temp file is left behind after a successful write", () => {
  withScratchDir((proofPath) => {
    writePluginActivationProof(proofPath, {
      writtenAt: new Date().toISOString(),
      loadedPluginIds: [],
      configuredHooks: {},
    });
    const siblings = fs.readdirSync(path.dirname(proofPath));
    assert.deepEqual(siblings, [path.basename(proofPath)]);
  });
});

test("a second write fully overwrites the first (this boot's proof always wins over a stale prior boot's)", () => {
  withScratchDir((proofPath) => {
    writePluginActivationProof(proofPath, {
      writtenAt: "2026-01-01T00:00:00.000Z",
      loadedPluginIds: ["okx-a2a"],
      configuredHooks: { "okx-a2a": "before_agent_run" },
    });
    writePluginActivationProof(proofPath, {
      writtenAt: "2026-01-02T00:00:00.000Z",
      loadedPluginIds: ["okx-a2a", "repodiet-a2a-bridge"],
      configuredHooks: { "okx-a2a": "before_agent_run", "repodiet-a2a-bridge": "before_agent_reply" },
    });
    const proof = readPluginActivationProof(proofPath);
    assert.deepEqual(proof?.loadedPluginIds, ["okx-a2a", "repodiet-a2a-bridge"]);
  });
});

test("readPluginActivationProof returns null (never throws, never defaults to trusting) for a missing file", () => {
  withScratchDir((proofPath) => {
    assert.equal(readPluginActivationProof(proofPath), null);
  });
});

test("readPluginActivationProof returns null for unparseable or malformed content", () => {
  withScratchDir((proofPath) => {
    fs.mkdirSync(path.dirname(proofPath), { recursive: true });
    fs.writeFileSync(proofPath, "not json", "utf8");
    assert.equal(readPluginActivationProof(proofPath), null);

    fs.writeFileSync(proofPath, JSON.stringify({ writtenAt: "x" }), "utf8");
    assert.equal(readPluginActivationProof(proofPath), null, "missing loadedPluginIds must not be treated as valid");

    fs.writeFileSync(
      proofPath,
      JSON.stringify({ writtenAt: "x", loadedPluginIds: "not-an-array", configuredHooks: {} }),
      "utf8"
    );
    assert.equal(readPluginActivationProof(proofPath), null, "loadedPluginIds must genuinely be an array");
  });
});

// --- isPluginActivationProven ---------------------------------------------

const REAL_PROOF: PluginActivationProof = {
  writtenAt: "2026-07-31T00:00:00.000Z",
  loadedPluginIds: ["okx-a2a", "repodiet-a2a-bridge"],
  configuredHooks: { "okx-a2a": "before_agent_run", "repodiet-a2a-bridge": "before_agent_reply" },
};

test("isPluginActivationProven is true only when the plugin id is loaded AND its configured hook matches what was requested", () => {
  assert.equal(isPluginActivationProven(REAL_PROOF, "okx-a2a", "before_agent_run"), true);
  assert.equal(isPluginActivationProven(REAL_PROOF, "repodiet-a2a-bridge", "before_agent_reply"), true);
});

test("isPluginActivationProven is false for a null proof (never seen yet) rather than throwing", () => {
  assert.equal(isPluginActivationProven(null, "okx-a2a", "before_agent_run"), false);
});

test("isPluginActivationProven is false for a plugin id that is not in the loaded list", () => {
  assert.equal(isPluginActivationProven(REAL_PROOF, "some-other-plugin", "before_agent_run"), false);
});

test("isPluginActivationProven is false when the requested hook does not match what this boot actually configured — a drifted expectation must fail closed, not silently pass", () => {
  assert.equal(isPluginActivationProven(REAL_PROOF, "okx-a2a", "before_agent_reply"), false);
});

console.log("plugin-activation-proof: all passed");
