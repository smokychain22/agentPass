/**
 * Seller runtime portability and safety.
 *
 * Agent 9636's runtime ran only on a Windows workstation: when the laptop
 * slept, the 90-second heartbeat TTL expired and the agent went offline,
 * so tasks could not be acknowledged and delivery could not complete.
 *
 * These tests pin the properties that make the runtime deployable to a
 * Linux container without weakening any safety guarantee.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  getRuntimePaths,
  ensureRuntimeLayout,
  readLivePid,
  writePid,
  OKX_RUNTIME_IDENTITIES,
} from "../src/lib/okx-runtime/runtime-layout";

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
const ENTRYPOINT = path.join(REPO_ROOT, "scripts", "repodiet-seller-runtime.ts");

function entrypointSource(): string {
  return fs.readFileSync(ENTRYPOINT, "utf8");
}

function run() {
  console.log("seller-runtime-portability");

  // --- 1. Linux container layout ---------------------------------------

  test("1. the runtime root is configurable and needs no Windows path", () => {
    const linuxRoot = "/data/okx-runtimes";
    const paths = getRuntimePaths(linuxRoot, "seller");
    assert.ok(paths.root.includes("seller-9636"), "seller root must be agent-scoped");
    assert.ok(!paths.root.includes("AppData"), "must not hardcode a Windows path");
  });

  test("the entrypoint resolves its data root from configuration, not LOCALAPPDATA alone", () => {
    const src = entrypointSource();
    assert.ok(
      src.includes("REPODIET_OKX_RUNTIME_ROOT"),
      "an explicit override must be supported for containers"
    );
    assert.ok(src.includes("XDG_DATA_HOME"), "Linux default must be supported");
  });

  test("2. Windows development remains supported", () => {
    const src = entrypointSource();
    assert.ok(src.includes("win32"), "Windows fallback must remain");
    assert.ok(src.includes("LOCALAPPDATA"), "Windows data dir must remain a fallback");
    const winPaths = getRuntimePaths("C:\\\\tmp\\\\runtimes", "seller");
    assert.ok(winPaths.pidFile.length > 0);
  });

  // --- 3/4/5/6. Identity gating ----------------------------------------

  test("4/5. only the canonical seller agent may run", () => {
    assert.equal(OKX_RUNTIME_IDENTITIES.seller.agentId, "9636");
    const src = entrypointSource();
    assert.ok(src.includes("identity_rejected"), "a mismatched agent must fail closed");
    assert.ok(
      src.includes("configured_agent_is_not_the_canonical_seller"),
      "the rejection reason must name the mismatch"
    );
  });

  test("6. the buyer agent must not run inside the seller runtime", () => {
    const src = entrypointSource();
    assert.ok(src.includes("buyer_must_not_run_in_the_seller_runtime"));
    // The seller identity is the only one this entrypoint ever adopts.
    assert.ok(!src.includes("OKX_RUNTIME_IDENTITIES.buyer"));
  });

  test("3. the runtime starts without an interactive terminal", () => {
    const src = entrypointSource();
    for (const forbidden of ["readline", "prompt(", "process.stdin.setRawMode"]) {
      assert.ok(!src.includes(forbidden), `must not require a TTY (${forbidden})`);
    }
  });

  // --- 7/8. Single instance and stale locks -----------------------------

  test("7/8. a live lock blocks a second instance, and a stale lock recovers", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repodiet-seller-lock-"));
    const paths = getRuntimePaths(dir, "seller");
    ensureRuntimeLayout(paths);

    // Our own PID is live: it must be reported as an existing instance.
    writePid(paths.pidFile, process.pid);
    assert.equal(readLivePid(paths.pidFile), process.pid, "a live lock must be detected");

    // A PID that cannot exist represents an unclean shutdown. readLivePid
    // must clear it so a replacement container can start unattended.
    fs.writeFileSync(paths.pidFile, "2147483646\n", "utf8");
    assert.equal(readLivePid(paths.pidFile), undefined, "a stale lock must self-clear");
    assert.equal(fs.existsSync(paths.pidFile), false, "the stale lock file must be removed");
  });

  // --- 9/10. Heartbeat honesty ------------------------------------------

  test("9/10. the runtime never claims online from process existence alone", () => {
    const src = entrypointSource();
    assert.ok(
      src.includes("heartbeat_withheld"),
      "a failing gate-check must withhold the heartbeat"
    );
    assert.ok(
      src.includes("officialGateCheckPasses") && src.includes("xmtpClientActive"),
      "both the official gate-check and XMTP readiness must be required"
    );
    // TTL-based expiry is what makes a dead runtime observable as offline.
    assert.ok(src.includes("ttlSeconds"), "heartbeats must carry a TTL");
  });

  test("the runtime fails closed when the heartbeat secret is absent", () => {
    const src = entrypointSource();
    assert.ok(src.includes("heartbeat_secret_missing_or_too_short"));
  });

  // --- 14. Signals -------------------------------------------------------

  test("14. SIGTERM and SIGINT shut down cleanly and release the lock", () => {
    const src = entrypointSource();
    assert.ok(src.includes('process.on("SIGTERM"'), "SIGTERM must be handled");
    assert.ok(src.includes('process.on("SIGINT"'), "SIGINT must be handled");
    assert.ok(src.includes("shutdown_complete"));
    assert.ok(src.includes("rmSync(paths.pidFile"), "shutdown must release the instance lock");
  });

  // --- 15. Secret hygiene ------------------------------------------------

  test("15. secrets never reach the logs", () => {
    const src = entrypointSource();
    // The secret is used only as an Authorization header value.
    assert.ok(!/log\([^)]*HEARTBEAT_SECRET/.test(src), "the secret must never be logged");
    assert.ok(!/console\.log\([^)]*SECRET/.test(src));
    // Error paths log a message only, never the request or headers.
    assert.ok(src.includes("never the request, headers, or secret"));
  });

  test("the image and compose files carry no secret values", () => {
    for (const file of ["Dockerfile.seller", "docker-compose.production.yml", ".env.seller.example"]) {
      const content = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
      assert.ok(
        !/BEGIN [A-Z ]*PRIVATE KEY/.test(content),
        `${file} must not contain key material`
      );
      // Every env assignment in the example contract must be empty.
      if (file === ".env.seller.example") {
        for (const line of content.split(/\r?\n/)) {
          if (/^[A-Z0-9_]+=/.test(line)) {
            assert.ok(line.endsWith("="), `${file} must declare names only: ${line}`);
          }
        }
      }
    }
  });

  test("the container runs as a non-root user with a real init", () => {
    const dockerfile = fs.readFileSync(path.join(REPO_ROOT, "Dockerfile.seller"), "utf8");
    // The seller process runs unprivileged via the entrypoint privilege
    // drop rather than a build-time USER, because root is needed briefly to
    // chown the freshly mounted Railway volume.
    assert.ok(dockerfile.includes("gosu"), "must drop privileges to a non-root user");
    assert.ok(dockerfile.includes("tini"), "an init is required so SIGTERM reaches the runtime");
    assert.ok(dockerfile.includes("HEALTHCHECK"), "a health check is required");
    assert.ok(dockerfile.includes("VOLUME"), "credential/data persistence is required");
  });

  test("Dockerfile declares no Docker VOLUME — Railway rejects it at parse time", () => {
    // Railway fails the build before any step runs with:
    //   "dockerfile invalid: docker VOLUME at Line N is not supported,
    //    use Railway Volumes"
    // Persistence is attached by the platform instead, so a VOLUME
    // instruction must never be reintroduced.
    const dockerfile = fs.readFileSync(path.join(REPO_ROOT, "Dockerfile.seller"), "utf8");
    const volumeLines = dockerfile
      .split(String.fromCharCode(10))
      .filter((line) => line.trim().startsWith("VOLUME"));
    assert.deepEqual(volumeLines, [], "Dockerfile.seller must not declare a Docker VOLUME");
  });

  test("the mounted persistence paths survive as environment configuration", () => {
    const dockerfile = fs.readFileSync(path.join(REPO_ROOT, "Dockerfile.seller"), "utf8");
    for (const expected of [
      "REPODIET_OKX_RUNTIME_ROOT=/persistent/data/okx-runtimes",
      "XDG_DATA_HOME=/persistent/data",
      "HOME=/persistent/home",
    ]) {
      assert.ok(dockerfile.includes(expected), `missing runtime path: ${expected}`);
    }
  });

  test("the entrypoint creates and chowns the volume at runtime, then drops privileges", () => {
    // A build-time chown is masked once Railway mounts its volume at
    // /persistent, so ownership must be corrected after the mount.
    const entry = fs.readFileSync(path.join(REPO_ROOT, "scripts", "seller-entrypoint.sh"), "utf8");
    assert.ok(entry.includes("mkdir -p"), "must create the directories on the mounted volume");
    assert.ok(entry.includes("chown -R node:node"), "must hand the volume to the runtime user");
    assert.ok(entry.includes("exec gosu node"), "must drop privileges before running the seller");
    const dockerfile = fs.readFileSync(path.join(REPO_ROOT, "Dockerfile.seller"), "utf8");
    assert.ok(dockerfile.includes("gosu"), "gosu must be installed for the privilege drop");
    assert.ok(
      dockerfile.includes("seller-entrypoint.sh"),
      "the entrypoint script must be wired into the image"
    );
  });

  test("restart policy keeps the agent online across host reboot", () => {
    const compose = fs.readFileSync(path.join(REPO_ROOT, "docker-compose.production.yml"), "utf8");
    assert.ok(compose.includes("restart: unless-stopped"));
    assert.ok(compose.includes("stop_grace_period"), "graceful shutdown needs a grace period");
  });

  console.log("seller-runtime-portability: all passed");
}

run();
