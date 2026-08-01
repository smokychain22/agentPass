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
      src.includes("refreshOfficialGateCheck") && src.includes("xmtpClientActive"),
      "both the official gate-check and XMTP readiness must be required"
    );
    // Incident #13 moved the gate-check onto its own timer, so the tick reads
    // a cached proof — that proof must still be a real pass, and still expire.
    assert.ok(
      src.includes("gateProofIsFresh") && src.includes("GATE_CHECK_FRESHNESS_MS"),
      "the cached gate-check proof must be freshness-bounded, never assumed valid indefinitely"
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

  test("the container process starts via a single exec'd chain so SIGTERM actually reaches the runtime's handler", () => {
    // Verified by direct reproduction in a real running container: CMD
    // ["npx", "tsx", ...] spawns through npm exec -> sh -c -> tsx's CLI, none
    // of which is a single exec'd chain — SIGTERM never reached the runtime's
    // own process.on("SIGTERM") handler, the container was killed raw (exit
    // 143), and shutdown_started/shutdown_complete never got logged, meaning
    // the instance lock was never released. node_modules/.bin/tsx is a shell
    // shim that itself ends in `exec`, so invoking it directly keeps tini ->
    // gosu (execs) -> tsx shim (execs) -> node as one signal-transparent chain.
    const dockerfile = fs.readFileSync(path.join(REPO_ROOT, "Dockerfile.seller"), "utf8");
    assert.ok(
      dockerfile.includes('CMD ["node_modules/.bin/tsx", "scripts/seller-runtime-supervisor.ts"]'),
      "must exec the local tsx binary directly against the supervisor entrypoint, not via npx"
    );
    assert.ok(!/CMD \[.?"npx"/.test(dockerfile), "must not run the entrypoint command through npx");
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

  test("the entrypoint re-asserts HOME through gosu — verified by direct reproduction that gosu resets HOME to the target user's /etc/passwd entry, discarding the Dockerfile's ENV HOME=/persistent/home and silently redirecting every OpenClaw/OnchainOS/okx-a2a write to the ephemeral filesystem", () => {
    const entry = fs.readFileSync(path.join(REPO_ROOT, "scripts", "seller-entrypoint.sh"), "utf8");
    assert.ok(
      entry.includes('exec gosu node env HOME="$HOME" "$@"'),
      "gosu must be followed by an explicit env HOME=... re-assertion, or every persisted-volume write silently goes to the wrong, non-persisted path"
    );
  });

  test("the entrypoint script and Dockerfile are LF-only — a CRLF shebang makes the container fail to start", () => {
    // Reproduced for real: building this image from a CRLF working tree
    // (produced here by Windows git core.autocrlf=true with no .gitattributes
    // override) fails at container start with exactly:
    //   [FATAL tini (8)] exec /usr/local/bin/seller-entrypoint.sh failed: No such file or directory
    // because the kernel looks for an interpreter literally named "/bin/sh\r".
    // The git-committed blob was already clean LF; only the local checkout
    // was corrupted — but nothing enforced that before this test/attributes
    // file existed, so any Windows contributor's local Docker build (or a
    // future edit saved with CRLF) could silently reintroduce this.
    for (const relPath of ["scripts/seller-entrypoint.sh", "Dockerfile.seller"]) {
      const raw = fs.readFileSync(path.join(REPO_ROOT, relPath));
      assert.ok(!raw.includes(Buffer.from("\r\n")), `${relPath} must not contain CRLF line endings`);
    }
  });

  test(".gitattributes forces LF for shell scripts and Dockerfiles regardless of the checkout client's autocrlf setting", () => {
    const attrs = fs.readFileSync(path.join(REPO_ROOT, ".gitattributes"), "utf8");
    assert.ok(/\*\.sh\s+text\s+eol=lf/.test(attrs));
    assert.ok(/Dockerfile\*\s+text\s+eol=lf/.test(attrs));
  });

  test("restart policy keeps the agent online across host reboot", () => {
    const compose = fs.readFileSync(path.join(REPO_ROOT, "docker-compose.production.yml"), "utf8");
    assert.ok(compose.includes("restart: unless-stopped"));
    assert.ok(compose.includes("stop_grace_period"), "graceful shutdown needs a grace period");
  });

  // --- OnchainOS: pinned, checksum-verified install ----------------------

  test("OnchainOS installs from a pinned release tag, not a moving install.sh", () => {
    const dockerfile = fs.readFileSync(path.join(REPO_ROOT, "Dockerfile.seller"), "utf8");
    assert.ok(
      /ONCHAINOS_RELEASE_TAG=v?\d+\.\d+\.\d+/.test(dockerfile),
      "an immutable semantic release tag must be pinned"
    );
    assert.ok(
      dockerfile.includes("okx/onchainos-skills/releases/download/"),
      "must download from the official release asset URL, not a branch"
    );
    assert.ok(
      !/install\.sh\s*(\||`|\$\().*sh\b/.test(dockerfile) && !/curl[^\n]*install\.sh[^\n]*\|\s*sh/.test(dockerfile),
      "must not pipe the moving-main installer into sh"
    );
  });

  test("OnchainOS download is checksum-verified and the build fails closed", () => {
    const dockerfile = fs.readFileSync(path.join(REPO_ROOT, "Dockerfile.seller"), "utf8");
    assert.ok(/ONCHAINOS_LINUX_SHA256=[0-9a-f]{64}/.test(dockerfile), "a real SHA-256 must be pinned");
    assert.ok(dockerfile.includes("sha256sum -c"), "the checksum must actually be verified");
    assert.ok(dockerfile.includes("onchainos --version"), "the binary must be proven to run before the build succeeds");
    assert.ok(!dockerfile.includes("|| true"), "the install must not be allowed to fail silently");
    assert.ok(!/\|\|\s*echo/.test(dockerfile), "the install must not fall back to a warning instead of failing");
  });

  test("npm ci skips Playwright's browser-binary download — this image never runs the e2e suite and that download is a separate, unrelated, much larger network dependency", () => {
    const dockerfile = fs.readFileSync(path.join(REPO_ROOT, "Dockerfile.seller"), "utf8");
    const npmCiIndex = dockerfile.indexOf("RUN npm ci");
    const envIndex = dockerfile.indexOf("ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1");
    assert.ok(envIndex > -1, "must skip the Playwright browser download");
    assert.ok(envIndex < npmCiIndex, "must be set before npm ci runs @playwright/test's postinstall hook");
  });

  // --- @okxweb3/a2a-openclaw's own runtime dependency (Incident #5) ------

  test("@sentry/node is a real, pinned dependency satisfying @okxweb3/a2a-openclaw's own declared requirement", () => {
    // Verified directly against the real published @okxweb3/a2a-openclaw@0.1.11
    // package.json: "dependencies": { "@sentry/node": "^7.74.1" } — a real
    // runtime dependency of the plugin itself, not guessed. Without this
    // installed in the image, the plugin's own dist/index.js fails to load
    // with "Cannot find module '@sentry/node'" — reproduced live on
    // repodiet-agent-9636, only discovered once the Gateway actually tried
    // to require() the plugin, well after the build itself had already
    // succeeded (extracting/checksumming files proves nothing about whether
    // they can actually load).
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
    const version = pkg.dependencies?.["@sentry/node"];
    assert.ok(version, "@sentry/node must be a real pinned dependency in package.json");
    const major = Number(version.replace(/^[^\d]*/, "").split(".")[0]);
    assert.ok(major >= 7, `@sentry/node@${version} must satisfy the plugin's own ^7.74.1 requirement`);
  });

  test("the build proves both plugins actually load and activate, not just that their files were extracted correctly", () => {
    // A checksum match and a successful `tar -xzf` prove the plugin's files
    // are byte-correct; they prove nothing about whether the plugin's own
    // require()'d dependencies are present, which is exactly what the
    // @sentry/node gap above slipped through. This must run AFTER the
    // plugin extraction step, so it can actually load what was just
    // extracted.
    const dockerfile = fs.readFileSync(path.join(REPO_ROOT, "Dockerfile.seller"), "utf8");
    const extractIndex = dockerfile.indexOf(
      "test -f /app/openclaw-plugins/okx-a2a-openclaw/openclaw.plugin.json"
    );
    const verifyIndex = dockerfile.indexOf("scripts/verify-openclaw-plugins-load.ts");
    assert.ok(extractIndex > -1, "the plugin extraction step must still exist");
    assert.ok(verifyIndex > -1, "the build-time plugin-load verification step must exist");
    assert.ok(extractIndex < verifyIndex, "verification must run after extraction, not before");
  });

  test("the build-time plugin-load verification never bakes its placeholder token or scratch HOME into the image", () => {
    const dockerfile = fs.readFileSync(path.join(REPO_ROOT, "Dockerfile.seller"), "utf8");
    assert.ok(
      !/^ENV\s+OPENCLAW_GATEWAY_TOKEN/m.test(dockerfile),
      "the placeholder token must be a RUN-scoped shell export, never a Dockerfile ENV"
    );
    assert.ok(
      dockerfile.includes('export OPENCLAW_GATEWAY_TOKEN="build-time-verification-placeholder-not-a-real-secret"'),
      "must use an explicit, unmistakably-fake placeholder value"
    );
    assert.ok(dockerfile.includes('rm -rf "$HOME"'), "the scratch HOME used for verification must be cleaned up");
  });

  test("the plugin-load verification script reuses the real supervisor's exact batch/plugin/hook definitions, not a hand-maintained duplicate", () => {
    const verifyScript = fs.readFileSync(
      path.join(REPO_ROOT, "scripts", "verify-openclaw-plugins-load.ts"),
      "utf8"
    );
    assert.ok(verifyScript.includes('from "./seller-runtime-supervisor"'));
    assert.ok(verifyScript.includes("buildOpenclawConfigBatch"));
    assert.ok(verifyScript.includes("parsePluginInspection"));
  });

  test("curl is installed so the pinned OnchainOS asset can be downloaded", () => {
    const dockerfile = fs.readFileSync(path.join(REPO_ROOT, "Dockerfile.seller"), "utf8");
    assert.ok(/apt-get install[^\n]*\bcurl\b/.test(dockerfile));
  });

  test("the checksum used to verify OnchainOS comes from the release's own live checksums.txt, not a bare unexplained constant", () => {
    const dockerfile = fs.readFileSync(path.join(REPO_ROOT, "Dockerfile.seller"), "utf8");
    assert.ok(
      dockerfile.includes("okx/onchainos-skills/releases/download/${ONCHAINOS_RELEASE_TAG}") &&
        dockerfile.includes('"${base}/checksums.txt"'),
      "must fetch the official checksums.txt for the pinned release"
    );
    assert.ok(
      dockerfile.includes("match_count"),
      "must verify exactly one checksums.txt line matches the requested asset"
    );
    assert.ok(
      dockerfile.includes('"${published_sha256}" != "${ONCHAINOS_LINUX_SHA256}"'),
      "must cross-check the live published checksum against the pinned expectation and fail on any mismatch"
    );
  });

  // --- Provider binding: official CLI only, no reimplemented adapter -----

  test("codex and claude are rejected as the production A2A provider", () => {
    const src = entrypointSource();
    assert.ok(src.includes('A2A_PROVIDER === "codex"') && src.includes('A2A_PROVIDER === "claude"'));
    assert.ok(
      src.includes("codex_and_claude_are_development_tools_only_not_a_production_provider"),
      "the rejection must name why: dev tools must never be the production responder"
    );
  });

  test("the openclaw CLI itself is installed and pinned, not assumed to be bootstrapped by okx-a2a setup", () => {
    // Verified by direct reproduction: `okx-a2a setup openclaw` only installs
    // its OWN plugin into an already-installed openclaw CLI (it shells out to
    // `openclaw plugins install ...`); without openclaw on PATH it fails with
    // "spawn openclaw ENOENT". So the openclaw CLI itself must be pinned and
    // installed at build time, same as the other required CLIs.
    const dockerfile = fs.readFileSync(path.join(REPO_ROOT, "Dockerfile.seller"), "utf8");
    assert.ok(/ARG OPENCLAW_VERSION=\d+\.\d+\.\d+-\d+/.test(dockerfile), "openclaw version must be pinned");
    assert.ok(dockerfile.includes('npm install -g "openclaw@${OPENCLAW_VERSION}"'));
    assert.ok(dockerfile.includes("openclaw --version"), "must prove the binary runs before the build succeeds");
  });

  test("only openclaw and hermes are accepted, matching the CLI's closed provider enum", () => {
    const src = entrypointSource();
    assert.ok(src.includes('new Set(["openclaw", "hermes"])'));
    assert.ok(src.includes("unsupported_a2a_provider"));
    assert.ok(
      src.includes('|| "openclaw"'),
      "openclaw must be the default — the documented host-agnostic Agent host"
    );
  });

  test("readiness and daemon liveness use the official CLI, not a reimplementation", () => {
    const src = entrypointSource();
    assert.ok(src.includes('"doctor", "--fix", "--json"'), "must call the official readiness/repair command");
    assert.ok(src.includes('"daemon", "status"'), "must probe the official daemon status command");
    assert.ok(
      src.includes('"daemon", "start", "--provider", A2A_PROVIDER'),
      "must restart the daemon via the official start command, not a spawned child process"
    );
  });

  // --- Incident #11: okx-a2a's own OS-autostart mechanism is incompatible
  // with this systemd-less container and, once triggered, permanently
  // breaks every future `daemon start` call -----------------------------

  test("Incident #11: every daemon start call passes --no-autostart, the documented flag that skips okx-a2a's own systemd/launchd install-and-restart path entirely", () => {
    const src = entrypointSource();
    assert.ok(
      src.includes('["daemon", "start", "--provider", A2A_PROVIDER, "--no-autostart"]'),
      "daemon start must always pass --no-autostart — without it, every call unconditionally attempts an OS autostart install/restart that hangs for ~30-60s per systemctl call in this systemd-less container, and once the unit file is left behind, every future call (including doctor's own internal daemon_running fix, which has no equivalent flag) is permanently routed through the same broken path"
    );
  });

  test("Incident #11: the poisoning autostart unit file is proactively removed before AND after the one-time doctor --fix call, and again before every daemon start attempt", () => {
    const src = entrypointSource();
    assert.ok(
      src.includes("function disableOkxA2aOsAutostart"),
      "must define the defensive cleanup — doctor --fix's own internal daemon_running auto-fix has no --no-autostart-equivalent flag, so keeping the unit file absent is the only available lever"
    );
    const doctorFixIndex = src.indexOf("async function runDoctorFix(");
    const doctorFixOnceIndex = src.indexOf("async function runDoctorFixOnce(");
    const ensureDaemonRunningIndex = src.indexOf("async function ensureDaemonRunning(");
    assert.ok(doctorFixIndex > -1 && doctorFixOnceIndex > -1 && ensureDaemonRunningIndex > -1);
    const runDoctorFixBody = src.slice(doctorFixIndex, doctorFixOnceIndex);
    assert.ok(
      (runDoctorFixBody.match(/disableOkxA2aOsAutostart\(\)/g) ?? []).length >= 2,
      "runDoctorFix must call the cleanup both before and after the doctor --fix call (try/finally), not just once"
    );
    const ensureDaemonRunningBody = src.slice(ensureDaemonRunningIndex, src.indexOf("\n}\n", ensureDaemonRunningIndex));
    assert.ok(
      ensureDaemonRunningBody.includes("disableOkxA2aOsAutostart()"),
      "ensureDaemonRunning must also defensively clean up before every daemon start attempt, belt-and-braces alongside --no-autostart"
    );
  });

  test("Incident #11: the autostart-cleanup function never spawns a process — pure, bounded filesystem operations only, so it can never itself hang", () => {
    const src = entrypointSource();
    const start = src.indexOf("function disableOkxA2aOsAutostart");
    const braceStart = src.indexOf("{", start);
    let depth = 0;
    let end = -1;
    for (let i = braceStart; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    assert.ok(end > -1, "must be able to isolate the function body");
    const body = src.slice(start, end + 1);
    assert.ok(!body.includes("execFile"), "must never shell out — a hung subprocess is exactly the bug this function exists to avoid");
    assert.ok(body.includes("fs.rmSync") && body.includes("force: true"), "must remove the unit file unconditionally, never failing if it is already absent");
  });

  // --- Incident #12: unbounded per-heartbeat-tick CLI calls silently hung
  // the whole heartbeat loop forever, with no crash and no further log
  // output, once one of them stalled on a slow backend/network call -------

  test("Incident #12: the onchainos gate-check call is bounded by an explicit timeout", () => {
    const src = entrypointSource();
    const start = src.indexOf("async function refreshOfficialGateCheck(");
    assert.ok(start > -1, "the gate-check runner must exist");
    const body = src.slice(start, src.indexOf("\n}\n", start));
    assert.ok(
      body.includes('"onchainos"') && body.includes("timeout: GATE_CHECK_TIMEOUT_MS"),
      "every CLI call must be bounded — an unbounded call that stalls hangs the awaiting cycle forever, silently, with no further log line ever produced again"
    );
  });

  test("Incident #12: xmtpClientActive bounds its okx-a2a agent refresh call with a timeout", () => {
    const src = entrypointSource();
    const start = src.indexOf("async function xmtpClientActive(");
    assert.ok(start > -1);
    const body = src.slice(start, src.indexOf("\n}\n", start));
    assert.ok(
      body.includes('"okx-a2a"') && body.includes("timeout: 45_000"),
      "matches this file's existing pattern for every other execFileAsync call (doctor --fix, daemon status, daemon start), all of which are already bounded"
    );
  });

  // --- Incident #13: the gate-check is slower than the heartbeat tick, so
  // running it inline every tick could never succeed and overlapping ticks
  // piled up contending subprocesses ------------------------------------

  test("Incident #13: the 60s heartbeat tick never runs the slow gate-check inline — it reads the cached proof instead", () => {
    const src = entrypointSource();
    const start = src.indexOf("async function publishHeartbeat(");
    assert.ok(start > -1);
    const body = src.slice(start, src.indexOf("\n}\n", start));
    assert.ok(
      !body.includes("refreshOfficialGateCheck("),
      "publishHeartbeat must not invoke the gate-check inline — measured live at >90s against a 60s tick interval, which withholds every heartbeat and stacks contending subprocesses"
    );
    assert.ok(
      body.includes("gateProofIsFresh()"),
      "the tick must read the cached proof recorded by the separate refresh timer"
    );
  });

  test("Incident #13: a stale gate-check proof fails closed rather than being assumed valid", () => {
    const src = entrypointSource();
    const start = src.indexOf("function gateProofIsFresh(");
    assert.ok(start > -1);
    const body = src.slice(start, src.indexOf("\n}\n", start));
    assert.ok(
      body.includes("lastGateCheckPassedAtMs > 0") &&
        body.includes("GATE_CHECK_FRESHNESS_MS"),
      "freshness must require a real recorded pass AND bound its age — never default to true"
    );
  });

  test("Incident #13: freshness window exceeds the refresh interval so one slow refresh cannot flap the agent offline", () => {
    const src = entrypointSource();
    const refresh = src.match(/GATE_CHECK_REFRESH_MS\s*=\s*([0-9_]+)/);
    const fresh = src.match(/GATE_CHECK_FRESHNESS_MS\s*=\s*([0-9_]+)/);
    const timeout = src.match(/GATE_CHECK_TIMEOUT_MS\s*=\s*([0-9_]+)/);
    assert.ok(refresh && fresh && timeout, "all three gate-check timings must be declared as named constants");
    const refreshMs = Number(refresh![1].replace(/_/g, ""));
    const freshMs = Number(fresh![1].replace(/_/g, ""));
    const timeoutMs = Number(timeout![1].replace(/_/g, ""));
    assert.ok(freshMs > refreshMs, "a proof must stay valid longer than the gap between refreshes");
    assert.ok(timeoutMs > 90_000, "the bound must exceed the >90s the gate-check was measured taking live");
    assert.ok(freshMs >= refreshMs + timeoutMs, "one full slow refresh must fit inside the freshness window");
  });

  test("Incident #13: both the heartbeat cycle and the gate-check refresh guard against overlapping runs", () => {
    const src = entrypointSource();
    assert.ok(
      src.includes("heartbeatCycleInFlight") && src.includes("heartbeat_cycle_skipped_still_running"),
      "setInterval fires regardless of whether the previous cycle finished; without a guard slow cycles stack and contend"
    );
    assert.ok(
      src.includes("gateCheckInFlight") && src.includes("gate_check_skipped_still_running"),
      "a gate-check that outlives its own refresh interval must not stack either"
    );
  });

  test("Incident #13: the gate-check refresh timer is cleared on shutdown alongside the heartbeat timer", () => {
    const src = entrypointSource();
    const start = src.indexOf("function shutdown(");
    assert.ok(start > -1);
    const body = src.slice(start, src.indexOf("\n}\n", start));
    assert.ok(
      body.includes("clearInterval(gateCheckTimer)"),
      "a leaked interval keeps the process alive past shutdown"
    );
  });

  // --- Incident #14: the gate-check cadence was still too aggressive for
  // what the command costs, so the agent could not hold uptime ----------

  test("Incident #14: the expensive gate-check runs on a deep-audit cadence, not a tight loop", () => {
    const src = entrypointSource();
    const refresh = Number(src.match(/GATE_CHECK_REFRESH_MS\s*=\s*([0-9_]+)/)![1].replace(/_/g, ""));
    const fresh = Number(src.match(/GATE_CHECK_FRESHNESS_MS\s*=\s*([0-9_]+)/)![1].replace(/_/g, ""));
    const timeout = Number(src.match(/GATE_CHECK_TIMEOUT_MS\s*=\s*([0-9_]+)/)![1].replace(/_/g, ""));
    assert.ok(
      refresh >= 600_000,
      "measured live: this command shells out to a full okx-a2a doctor (including a ~29s npm-registry lookup) and ranged 14s to past 150s on one shared vCPU — running it every few minutes makes uptime hostage to its slowest external dependency"
    );
    assert.ok(
      fresh >= refresh + 2 * timeout,
      "the freshness window must survive at least two consecutive slow or failed refreshes; two in a row is exactly what took the agent offline"
    );
  });

  test("Incident #14: a persisted proof is re-validated against the same freshness bound, never blindly trusted", () => {
    const src = entrypointSource();
    const start = src.indexOf("function loadPersistedGateProof(");
    assert.ok(start > -1);
    const body = src.slice(start, src.indexOf("\n}\n", start));
    assert.ok(
      body.includes("GATE_CHECK_FRESHNESS_MS"),
      "a restart must not resurrect an expired proof"
    );
    assert.ok(
      body.includes("passedAtMs > Date.now()"),
      "a future-dated proof (clock skew or tampering) must be discarded, not trusted"
    );
    assert.ok(
      body.includes("Number.isFinite(passedAtMs)"),
      "an unparseable or corrupt proof must fail closed"
    );
  });

  test("Incident #14: a successful gate-check persists its proof so a restart need not re-prove from cold", () => {
    const src = entrypointSource();
    assert.ok(
      src.includes("persistGateProof(lastGateCheckPassedAtMs)"),
      "the proof must be written when the check genuinely passes"
    );
    assert.ok(
      /loadPersistedGateProof\(\);\s*\n\s*if \(!gateProofIsFresh\(\)\) \{\s*\n\s*await refreshOfficialGateCheck\(\);/.test(src),
      "startup must restore first and still block on a real check whenever the restored proof is not fresh"
    );
  });

  // --- Single bootstrap owner (Incident #2 remediation) ------------------
  //
  // scripts/seller-runtime-supervisor.ts is now the SOLE owner of OpenClaw
  // config bootstrap and okx-a2a provider selection — it starts this
  // process only after both are proven. Two independent boot-time callers
  // of `okx-a2a setup`/`ai-provider set` racing the same persisted
  // openclaw.json is exactly what produced the real corruption incident
  // (see docs/SELLER_RUNTIME_DEPLOYMENT.md), so this process must never
  // call either command itself.

  test("this process never calls okx-a2a setup or ai-provider set — the supervisor is the sole owner of provider configuration", () => {
    const src = entrypointSource();
    assert.ok(!src.includes("ensureProviderSetup"), "the duplicate provider-setup function must be removed, not merely unused");
    assert.ok(!/"setup",\s*A2A_PROVIDER/.test(src), "must not shell out to okx-a2a setup");
    assert.ok(!src.includes('"ai-provider"'), "provider selection belongs solely to the supervisor");
    assert.ok(!/--release/.test(src), "no boot command in this process may resolve a version at runtime");
  });

  test("establishCommunicationReadiness documents that provider/plugin bootstrap is owned elsewhere", () => {
    const src = entrypointSource();
    assert.ok(
      /owned exclusively by\r?\n \* scripts\/seller-runtime-supervisor\.ts/.test(src),
      "the ownership boundary must be documented at the call site, not just assumed"
    );
  });

  test("communication readiness runs once at startup, before the heartbeat loop begins", () => {
    const src = entrypointSource();
    const readinessCallIndex = src.indexOf("await establishCommunicationReadiness();");
    const firstHeartbeatIndex = src.indexOf("await publishHeartbeat();");
    assert.ok(readinessCallIndex > -1 && firstHeartbeatIndex > -1);
    assert.ok(readinessCallIndex < firstHeartbeatIndex, "setup must precede the first heartbeat attempt");
  });

  test("the heartbeat is withheld when the daemon is down, even if the gate-check and XMTP both pass", () => {
    const src = entrypointSource();
    assert.ok(
      src.includes("!daemonOk || !gateOk || !xmtpOk"),
      "daemon liveness must be a hard requirement for sending a heartbeat"
    );
    assert.ok(src.includes("daemonOk = await ensureDaemonRunning()"));
  });

  test("readiness events use the requested vocabulary: communication_ready, a2a_daemon_ready, xmtp_ready", () => {
    const src = entrypointSource();
    for (const event of ["communication_ready", "a2a_daemon_ready", "xmtp_ready"]) {
      assert.ok(src.includes(`"${event}"`), `missing log event: ${event}`);
    }
  });

  test("doctor output is parsed defensively: real JSON counters first, the observed text summary as fallback, never assumed ready", () => {
    const src = entrypointSource();
    assert.ok(src.includes("Summary:"), "must fall back to the directly-observed human summary format");
    assert.ok(src.includes("fail === 0"), "readiness must require zero failures, not merely a parse success");
    assert.ok(src.includes("return { ok: false, pass: 0, warn: 0, fail: -1 }"), "an unparseable result must fail closed, not default to ready");
  });

  test("doctor JSON parsing reads counts from the real verified schema (summary.pass/warn/fail), not an assumed top-level shape", () => {
    // Verified directly against the live pinned 0.1.11 CLI: `okx-a2a doctor
    // --fix --json` writes one JSON object to stdout shaped like
    // { ok, ready, summary: { pass, warn, fail, ... }, ... } — the counts are
    // nested, and a flat parsed.pass/warn/fail would silently never match.
    const src = entrypointSource();
    assert.ok(src.includes("parsed?.summary") || src.includes("const summary = parsed?.summary"));
    assert.ok(src.includes("summary?.pass") && src.includes("summary?.warn") && src.includes("summary?.fail"));
    assert.ok(
      src.includes('parsed?.ready === true && summary.fail === 0'),
      "readiness must require both the CLI's own ready flag and zero failures"
    );
    assert.ok(!/typeof parsed\?\.pass === "number"/.test(src), "must not read counts off a flat top-level shape");
  });

  test("doctor's diagnostic JSON is read even when the CLI exits non-zero — the ordinary case on a fresh container", () => {
    // Verified by direct reproduction in a real built container: `okx-a2a
    // doctor --fix --json` exits 1 (not 0) whenever there is a real blocking
    // failure (e.g. no provider bound yet on first boot) — `{"ok":false,
    // "ready":false,"blockingFailures":1,...}` is still valid, parseable
    // stdout. execFileAsync rejects on that non-zero exit, and Node attaches
    // the captured stdout to the rejection as `err.stdout` — discarding that
    // would make every first-boot container report a meaningless fail:-1
    // instead of the real diagnostic.
    const src = entrypointSource();
    assert.ok(
      src.includes("(err as { stdout?: string }"),
      "must read err.stdout when the doctor exec rejects, not discard it"
    );
    assert.ok(
      src.includes("fromFailedExec"),
      "the rejected exec's stdout must be captured into the same parse path as a successful exec, not a separate discard-only branch"
    );
  });

  test("doctor --fix is given enough time for a first-run install, per the CLI's own advisory", () => {
    // The live CLI prints: "--fix may take a few minutes on a fresh install
    // (plugin install, daemon start, XMTP warm-up)... allow at least 180s."
    const src = entrypointSource();
    const match = src.match(/"doctor", "--fix", "--json"\], \{ timeout: (\d+)_(\d+) \}/);
    assert.ok(match, "doctor --fix must set an explicit exec timeout");
    const timeoutMs = Number(`${match![1]}${match![2]}`);
    assert.ok(timeoutMs >= 180_000, `timeout ${timeoutMs}ms must be at least the CLI's documented 180s minimum`);
  });

  // --- Incident #2 remediation: no boot-time network dependency ----------

  test("no `--release latest` (or any --release) appears in any executable line — only in prose documenting the retired flag", () => {
    for (const relPath of ["Dockerfile.seller", "scripts/seller-runtime-supervisor.ts", "scripts/repodiet-seller-runtime.ts"]) {
      const content = fs.readFileSync(path.join(REPO_ROOT, relPath), "utf8");
      const executableLines = content
        .split(/\r?\n/)
        .filter((line) => !/^\s*(#|\/\/|\*)/.test(line));
      for (const line of executableLines) {
        assert.ok(!/--release/.test(line), `${relPath} must not resolve a version at runtime via --release: ${line}`);
      }
    }
  });

  test("no npm install/upgrade is reachable from normal startup — only from Dockerfile RUN (build time)", () => {
    for (const relPath of ["scripts/seller-runtime-supervisor.ts", "scripts/repodiet-seller-runtime.ts"]) {
      const content = fs.readFileSync(path.join(REPO_ROOT, relPath), "utf8");
      const executableLines = content
        .split(/\r?\n/)
        .filter((line) => !/^\s*(#|\/\/|\*)/.test(line));
      for (const line of executableLines) {
        assert.ok(!/npm\s+(install|update|i\s)/.test(line), `${relPath} must not invoke npm at runtime: ${line}`);
        assert.ok(!/"setup"/.test(line), `${relPath} must not call the broad, network-dependent setup command: ${line}`);
      }
    }
  });

  test("@okxweb3/a2a-openclaw is pinned and checksum-verified into the image at build time, not installed at boot", () => {
    const dockerfile = fs.readFileSync(path.join(REPO_ROOT, "Dockerfile.seller"), "utf8");
    assert.ok(/ARG OKX_A2A_OPENCLAW_PLUGIN_VERSION=\d+\.\d+\.\d+/.test(dockerfile), "plugin version must be pinned");
    assert.ok(
      /ARG OKX_A2A_OPENCLAW_PLUGIN_INTEGRITY=sha512-[A-Za-z0-9+/=]+/.test(dockerfile),
      "a real npm sha512 integrity value must be pinned"
    );
    assert.ok(dockerfile.includes('npm pack "@okxweb3/a2a-openclaw@${OKX_A2A_OPENCLAW_PLUGIN_VERSION}"'));
    assert.ok(
      dockerfile.includes('"${actual_integrity}" != "${OKX_A2A_OPENCLAW_PLUGIN_INTEGRITY}"'),
      "the build must fail closed on any integrity mismatch"
    );
    assert.ok(dockerfile.includes("test -f /app/openclaw-plugins/okx-a2a-openclaw/openclaw.plugin.json"), "the build must prove the manifest actually extracted before succeeding");
  });

  test("the okx-a2a-openclaw plugin directory is extracted AFTER chown, so it lands root-owned like the bridge plugin", () => {
    // Verified by direct reproduction: OpenClaw's plugin loader refuses a
    // plugins.load.paths entry owned by a non-root uid ("blocked plugin
    // candidate: suspicious ownership ... expected uid=0 or root").
    const dockerfile = fs.readFileSync(path.join(REPO_ROOT, "Dockerfile.seller"), "utf8");
    const chownIndex = dockerfile.indexOf("RUN chown -R node:node /app");
    const bridgeCopyIndex = dockerfile.indexOf("COPY openclaw-plugins ./openclaw-plugins");
    const okxPluginIndex = dockerfile.indexOf("ARG OKX_A2A_OPENCLAW_PLUGIN_VERSION");
    assert.ok(chownIndex > -1 && bridgeCopyIndex > -1 && okxPluginIndex > -1);
    assert.ok(chownIndex < bridgeCopyIndex, "the bridge plugin must be placed after the chown to stay root-owned");
    assert.ok(chownIndex < okxPluginIndex, "the okx-a2a-openclaw plugin must be placed after the chown to stay root-owned");
  });

  // --- fly.toml: bounded restart policy during development ---------------

  test("fly.toml restart policy is temporarily bounded (on-failure, retries=3) while the new bootstrap is validated", () => {
    const flyToml = fs.readFileSync(path.join(REPO_ROOT, "fly.toml"), "utf8");
    assert.ok(flyToml.includes("[[restart]]"), "must keep the array-of-tables syntax flyctl requires");
    assert.ok(/policy\s*=\s*"on-failure"/.test(flyToml));
    assert.ok(/retries\s*=\s*3/.test(flyToml));
  });

  console.log("seller-runtime-portability: all passed");
}

run();
