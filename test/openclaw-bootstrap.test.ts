/**
 * Safe, idempotent, version-aware OpenClaw config bootstrap primitives
 * (src/lib/okx-runtime/openclaw-bootstrap.ts) — built after a real
 * production incident where a concurrent diagnostic command raced the
 * supervisor's own config writes and left the persisted openclaw.json
 * broken on every subsequent restart. These tests exercise the lock,
 * validation/quarantine, and marker logic against a real temp directory
 * (not mocked fs), so they prove genuine file-system behavior.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  acquireBootstrapLock,
  releaseBootstrapLock,
  validateOpenclawConfigFile,
  quarantineInvalidConfig,
  computeConfigSchemaHash,
  readBootstrapMarker,
  writeBootstrapMarker,
  bootstrapMarkerMatches,
  openclawHomeDir,
  openclawConfigPath,
  bootstrapLockPath,
  bootstrapMarkerPath,
  type BootstrapVersions,
} from "../src/lib/okx-runtime/openclaw-bootstrap";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

function freshHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "repodiet-openclaw-bootstrap-"));
}

function envWithHome(home: string): NodeJS.ProcessEnv {
  return { ...process.env, HOME: home };
}

const SAMPLE_VERSIONS: BootstrapVersions = {
  onchainOsVersion: "4.4.1",
  okxA2aVersion: "0.1.10",
  openclawVersion: "2026.7.1-2",
  okxA2aOpenclawPluginVersion: "0.1.10",
  pluginIds: ["okx-a2a", "repodiet-a2a-bridge", "provider:openclaw"],
  configSchemaHash: computeConfigSchemaHash(["gateway.mode", "gateway.auth.token"]),
};

function run() {
  console.log("openclaw-bootstrap");

  // --- Path helpers --------------------------------------------------------

  test("path helpers derive everything from HOME so they follow the mounted /persistent/home volume", () => {
    const env = envWithHome("/persistent/home");
    assert.equal(openclawHomeDir(env), "/persistent/home");
    assert.equal(openclawConfigPath(env), path.join("/persistent/home", ".openclaw", "openclaw.json"));
    assert.equal(bootstrapLockPath(env), path.join("/persistent/home", ".openclaw", "repodiet-bootstrap.lock"));
    assert.equal(bootstrapMarkerPath(env), path.join("/persistent/home", ".openclaw", "repodiet-bootstrap-marker.json"));
  });

  // --- Exclusive bootstrap lock (prevents concurrent writers) ------------

  test("a second process cannot acquire the lock while the first (live) holder still owns it", () => {
    const home = freshHome();
    const lockPath = bootstrapLockPath(envWithHome(home));
    const first = acquireBootstrapLock(lockPath, process.pid);
    assert.equal(first.acquired, true);

    // A different, definitely-live pid (our own) simulates a second process
    // racing the same lock file — this is exactly the failure mode from the
    // real incident (a concurrent `fly ssh console` diagnostic racing the
    // supervisor's own config writes).
    const second = acquireBootstrapLock(lockPath, 999999);
    assert.equal(second.acquired, false);
    assert.equal(second.reason, "held_by_live_process");
    assert.equal(second.holderPid, process.pid);

    releaseBootstrapLock(lockPath, process.pid);
  });

  test("releasing the lock lets a subsequent acquire succeed", () => {
    const home = freshHome();
    const lockPath = bootstrapLockPath(envWithHome(home));
    acquireBootstrapLock(lockPath, process.pid);
    releaseBootstrapLock(lockPath, process.pid);
    const reacquired = acquireBootstrapLock(lockPath, process.pid);
    assert.equal(reacquired.acquired, true);
  });

  test("a lock held by a dead pid is treated as abandoned and reclaimed", () => {
    const home = freshHome();
    const lockPath = bootstrapLockPath(envWithHome(home));
    // A pid guaranteed not to be alive on any real system.
    const deadPid = 2147483646;
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, JSON.stringify({ pid: deadPid, acquiredAt: new Date().toISOString() }));

    const result = acquireBootstrapLock(lockPath, process.pid);
    assert.equal(result.acquired, true, "a lock held by a dead pid must be reclaimable");
  });

  test("releasing a lock never removes another holder's lock — only the pid that acquired it may release it", () => {
    const home = freshHome();
    const lockPath = bootstrapLockPath(envWithHome(home));
    acquireBootstrapLock(lockPath, process.pid);
    // A different pid attempts to release — must be a no-op.
    releaseBootstrapLock(lockPath, 999999);
    assert.ok(fs.existsSync(lockPath), "the real holder's lock must survive an unrelated release call");
    releaseBootstrapLock(lockPath, process.pid);
    assert.ok(!fs.existsSync(lockPath));
  });

  // --- Config validation ----------------------------------------------------

  test("a missing config file is reported as missing, not invalid", () => {
    const home = freshHome();
    const configPath = openclawConfigPath(envWithHome(home));
    const result = validateOpenclawConfigFile(configPath);
    assert.equal(result.state, "missing");
  });

  test("a well-formed JSON object config is valid", () => {
    const home = freshHome();
    const configPath = openclawConfigPath(envWithHome(home));
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ gateway: { mode: "local" } }), "utf8");
    const result = validateOpenclawConfigFile(configPath);
    assert.equal(result.state, "valid");
  });

  test("an empty file is reported as empty, distinct from invalid JSON", () => {
    const home = freshHome();
    const configPath = openclawConfigPath(envWithHome(home));
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, "", "utf8");
    const result = validateOpenclawConfigFile(configPath);
    assert.equal(result.state, "empty");
  });

  test("truncated/malformed JSON is reported as invalid_json — this is the real corruption shape from the production incident", () => {
    const home = freshHome();
    const configPath = openclawConfigPath(envWithHome(home));
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, '{"gateway": {"mode": "loc', "utf8");
    const result = validateOpenclawConfigFile(configPath);
    assert.equal(result.state, "invalid_json");
  });

  test("a JSON array or primitive at the top level is reported as invalid_shape", () => {
    const home = freshHome();
    const configPath = openclawConfigPath(envWithHome(home));
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, "[1,2,3]", "utf8");
    assert.equal(validateOpenclawConfigFile(configPath).state, "invalid_shape");
    fs.writeFileSync(configPath, "42", "utf8");
    assert.equal(validateOpenclawConfigFile(configPath).state, "invalid_shape");
  });

  // --- Quarantine (never delete) -------------------------------------------

  test("an invalid config is renamed to openclaw.json.corrupt-<timestamp>, never deleted, and the exact bytes are preserved", () => {
    const home = freshHome();
    const configPath = openclawConfigPath(envWithHome(home));
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const damaged = '{"gateway": {"mode": "loc';
    fs.writeFileSync(configPath, damaged, "utf8");

    const quarantined = quarantineInvalidConfig(configPath);
    assert.ok(quarantined);
    assert.ok(quarantined!.includes("openclaw.json.corrupt-"));
    assert.ok(!fs.existsSync(configPath), "the damaged path must no longer exist under its original name");
    assert.ok(fs.existsSync(quarantined!), "the quarantined file must exist");
    assert.equal(fs.readFileSync(quarantined!, "utf8"), damaged, "the exact damaged bytes must be preserved for recovery");
  });

  test("quarantining a config that does not exist is a no-op that returns null", () => {
    const home = freshHome();
    const configPath = openclawConfigPath(envWithHome(home));
    assert.equal(quarantineInvalidConfig(configPath), null);
  });

  test("quarantine never touches sibling wallet/credential files under the same .openclaw home", () => {
    const home = freshHome();
    const configPath = openclawConfigPath(envWithHome(home));
    const openclawDir = path.dirname(configPath);
    fs.mkdirSync(openclawDir, { recursive: true });
    fs.writeFileSync(configPath, "not json", "utf8");
    // Simulate OnchainOS wallet/credential state living alongside the config.
    const walletDir = path.join(home, "onchainos");
    fs.mkdirSync(walletDir, { recursive: true });
    const walletFile = path.join(walletDir, "wallet.json");
    fs.writeFileSync(walletFile, JSON.stringify({ address: "0xnotreal" }), "utf8");

    quarantineInvalidConfig(configPath);

    assert.ok(fs.existsSync(walletFile), "wallet state must be completely untouched by config quarantine");
    assert.equal(fs.readFileSync(walletFile, "utf8"), JSON.stringify({ address: "0xnotreal" }));
  });

  // --- Version-aware bootstrap marker --------------------------------------

  test("computeConfigSchemaHash is deterministic and independent of input order", () => {
    const a = computeConfigSchemaHash(["gateway.mode", "gateway.auth.token", "plugins.allow"]);
    const b = computeConfigSchemaHash(["plugins.allow", "gateway.mode", "gateway.auth.token"]);
    assert.equal(a, b, "the hash must not depend on call-site ordering");
    assert.equal(a.length, 16);
  });

  test("computeConfigSchemaHash changes when the operation list changes", () => {
    const a = computeConfigSchemaHash(["gateway.mode"]);
    const b = computeConfigSchemaHash(["gateway.mode", "session.dmScope"]);
    assert.notEqual(a, b, "adding a config-set operation must invalidate the schema hash");
  });

  test("writeBootstrapMarker + readBootstrapMarker round-trip and the write is atomic (write-temp-then-rename, no partial marker left behind)", () => {
    const home = freshHome();
    const markerPath = bootstrapMarkerPath(envWithHome(home));
    writeBootstrapMarker(markerPath, SAMPLE_VERSIONS);
    const readBack = readBootstrapMarker(markerPath);
    assert.ok(readBack);
    assert.equal(readBack!.onchainOsVersion, SAMPLE_VERSIONS.onchainOsVersion);
    assert.equal(readBack!.okxA2aVersion, SAMPLE_VERSIONS.okxA2aVersion);
    assert.ok(readBack!.writtenAt, "the marker must record when it was written");

    const leftoverTmp = fs.readdirSync(path.dirname(markerPath)).filter((f) => f.includes(".tmp"));
    assert.deepEqual(leftoverTmp, [], "no temp file should remain after an atomic write");
  });

  test("readBootstrapMarker returns null (never throws) when no marker exists yet", () => {
    const home = freshHome();
    const markerPath = bootstrapMarkerPath(envWithHome(home));
    assert.equal(readBootstrapMarker(markerPath), null);
  });

  test("readBootstrapMarker returns null for an unparseable marker file instead of throwing", () => {
    const home = freshHome();
    const markerPath = bootstrapMarkerPath(envWithHome(home));
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(markerPath, "not json", "utf8");
    assert.equal(readBootstrapMarker(markerPath), null);
  });

  test("bootstrapMarkerMatches is true only when every pinned version, the plugin id set (in order), and the config schema hash all match exactly", () => {
    const marker = { ...SAMPLE_VERSIONS, writtenAt: new Date().toISOString() };
    assert.equal(bootstrapMarkerMatches(marker, SAMPLE_VERSIONS), true);
  });

  test("bootstrapMarkerMatches is false when null (no prior marker — first boot)", () => {
    assert.equal(bootstrapMarkerMatches(null, SAMPLE_VERSIONS), false);
  });

  test("bootstrapMarkerMatches is false on any single pinned-version drift", () => {
    const marker = { ...SAMPLE_VERSIONS, writtenAt: new Date().toISOString() };
    for (const field of ["onchainOsVersion", "okxA2aVersion", "openclawVersion", "okxA2aOpenclawPluginVersion"] as const) {
      const drifted = { ...SAMPLE_VERSIONS, [field]: "9.9.9-drifted" };
      assert.equal(
        bootstrapMarkerMatches(marker, drifted),
        false,
        `a drift in ${field} must force a fresh bootstrap`
      );
    }
  });

  test("bootstrapMarkerMatches is false when the plugin id set changes (added, removed, or reordered)", () => {
    const marker = { ...SAMPLE_VERSIONS, writtenAt: new Date().toISOString() };
    assert.equal(
      bootstrapMarkerMatches(marker, { ...SAMPLE_VERSIONS, pluginIds: [...SAMPLE_VERSIONS.pluginIds, "extra-plugin"] }),
      false
    );
    assert.equal(
      bootstrapMarkerMatches(marker, { ...SAMPLE_VERSIONS, pluginIds: SAMPLE_VERSIONS.pluginIds.slice(0, 1) }),
      false
    );
    assert.equal(
      bootstrapMarkerMatches(marker, { ...SAMPLE_VERSIONS, pluginIds: [...SAMPLE_VERSIONS.pluginIds].reverse() }),
      false,
      "plugin id order is part of the identity — a reorder must not be silently trusted"
    );
  });

  test("bootstrapMarkerMatches is false when the config schema hash changes (a config-set operation was added/removed)", () => {
    const marker = { ...SAMPLE_VERSIONS, writtenAt: new Date().toISOString() };
    assert.equal(
      bootstrapMarkerMatches(marker, { ...SAMPLE_VERSIONS, configSchemaHash: computeConfigSchemaHash(["something.else"]) }),
      false
    );
  });

  console.log("openclaw-bootstrap: all passed");
}

run();
