/**
 * Deployment configuration regression tests: fly.toml (Fly.io testing
 * target), docker-compose.production.yml + deploy/repodiet-seller.service
 * (permanent Linux VM path), and cross-file consistency between them and
 * Dockerfile.seller. These files are not executed by any test runner —
 * flyctl/systemd never run in CI — so this suite pins their literal
 * content instead, the same style already used for Dockerfile.seller in
 * test/seller-runtime-portability.test.ts.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

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

function read(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), "utf8");
}

function run() {
  console.log("fly-and-linux-vm-deployment");

  // --- fly.toml ------------------------------------------------------------

  test("fly.toml targets the canonical app and builds Dockerfile.seller", () => {
    const toml = read("fly.toml");
    assert.ok(/^app\s*=\s*"repodiet-agent-9636"/m.test(toml), "must target the existing repodiet-agent-9636 app, not a new one");
    assert.ok(/dockerfile\s*=\s*"Dockerfile\.seller"/.test(toml), "must build the seller image, not the web app Dockerfile");
  });

  test("fly.toml mounts /persistent with the documented volume name", () => {
    const toml = read("fly.toml");
    const mounts = toml.match(/^\[mounts\]$[\s\S]*?(?=^\[|\s*$(?![\s\S]))/m);
    assert.ok(mounts, "must declare a [mounts] block");
    assert.ok(/source\s*=\s*"repodiet_persistent"/.test(mounts![0]));
    assert.ok(/destination\s*=\s*"\/persistent"/.test(mounts![0]));
  });

  test("fly.toml sets an explicit restart policy using the required array-of-tables syntax", () => {
    // Regression: `[restart]` (single table) fails real flyctl validation
    // with "json: cannot unmarshal object into Go struct field
    // Config.restart of type []appconfig.Restart" — confirmed both via
    // `fly config validate` locally and a live GitHub Actions deploy run
    // that failed on exactly this before the fix. Must be `[[restart]]`.
    const toml = read("fly.toml");
    assert.ok(!/^\[restart\]$/m.test(toml), "must not use the single-table [restart] form — flyctl rejects it");
    const restart = toml.match(/^\[\[restart\]\]$[\s\S]*?(?=^\[|\s*$(?![\s\S]))/m);
    assert.ok(restart, "must declare a [[restart]] array-of-tables block");
    assert.ok(/policy\s*=\s*"[a-z-]+"/.test(restart![0]), "a restart policy must be set explicitly");
  });

  test("fly.toml's restart policy is temporarily bounded (on-failure, retries=3) while the new idempotent bootstrap is validated", () => {
    // An unbounded `policy = "always"` loop is exactly what let the earlier
    // boot-time network dependency (Incident #2 — see
    // docs/SELLER_RUNTIME_DEPLOYMENT.md) burn trial runtime silently. Not
    // deployed by this PR — see the runbook for reverting to "always" once
    // the new bootstrap has proven itself stable in production.
    const toml = read("fly.toml");
    const restart = toml.match(/^\[\[restart\]\]$[\s\S]*?(?=^\[|\s*$(?![\s\S]))/m);
    assert.ok(restart, "must declare a [[restart]] array-of-tables block");
    assert.ok(/policy\s*=\s*"on-failure"/.test(restart![0]));
    assert.ok(/retries\s*=\s*3/.test(restart![0]));
  });

  test("fly.toml declares no public HTTP service or published port — this runtime is an outbound client only", () => {
    const toml = read("fly.toml");
    assert.ok(!/^\[http_service\]/m.test(toml), "must not allocate a public HTTP service/IP");
    assert.ok(!/^\[\[services\]\]/m.test(toml), "must not allocate a public services block");
  });

  test("fly.toml documents exactly-one-Machine intent and does not itself provision infrastructure", () => {
    const toml = read("fly.toml");
    assert.ok(/exactly one production Machine/i.test(toml));
    assert.ok(/does NOT (itself )?deploy or create infrastructure/i.test(toml));
  });

  test("fly.toml carries the required non-secret runtime identities, and no secret values", () => {
    const toml = read("fly.toml");
    for (const expected of [
      'HOME = "/persistent/home"',
      'XDG_DATA_HOME = "/persistent/data"',
      'REPODIET_OKX_RUNTIME_ROOT = "/persistent/data/okx-runtimes"',
      'REPODIET_OKX_AGENT_ID = "9636"',
      'REPODIET_OKX_RUNTIME_ROLE = "seller"',
      'REPODIET_OKX_A2A_PROVIDER = "openclaw"',
      'REPODIET_PRODUCTION_URL = "https://skillswap-virid-kappa.vercel.app"',
    ]) {
      assert.ok(toml.includes(expected), `missing env: ${expected}`);
    }
    assert.ok(!/BEGIN [A-Z ]*PRIVATE KEY/.test(toml));
    assert.ok(!/OPENCLAW_GATEWAY_TOKEN\s*=\s*"[^"]+"/.test(toml), "must not hardcode the gateway token value");
  });

  test("fly.toml declares the non-secret GITHUB_APP_SLUG required alongside the 5 staged GitHub App secrets", () => {
    // Regression: an earlier PR report claimed this was added to fly.toml
    // when it had only actually been added to .env.seller.example.
    // src/lib/github-app/config.ts's isGitHubAppConfigured() requires
    // GITHUB_APP_SLUG in addition to GITHUB_APP_ID/CLIENT_ID/CLIENT_SECRET/
    // PRIVATE_KEY — without it, the GitHub App is never usable even with
    // all five secrets correctly staged.
    const toml = read("fly.toml");
    assert.ok(
      /GITHUB_APP_SLUG\s*=\s*"repodiet-operator"/.test(toml),
      "fly.toml [env] must declare GITHUB_APP_SLUG = \"repodiet-operator\""
    );
  });

  test("fly.toml's memory value matches the live Machine's actual scale, set after real observed OOM kills of the openclaw-gateway process at both 512mb and 1024mb", () => {
    const toml = read("fly.toml");
    assert.ok(/memory\s*=\s*"2048mb"/.test(toml));
    assert.ok(!/memory\s*=\s*"512mb"/.test(toml), "the pre-OOM 512mb value must not linger");
    assert.ok(!/memory\s*=\s*"1024mb"/.test(toml), "the superseded 1024mb value must not linger");
    assert.ok(/size\s*=\s*"shared-cpu-1x"/.test(toml), "only memory was scaled — CPU count/size must remain unchanged");
    const runbook = read("docs/SELLER_RUNTIME_DEPLOYMENT.md");
    assert.ok(/measur/i.test(runbook) && /memory/i.test(runbook), "the runbook must document a memory-measurement procedure");
  });

  test("fly.toml uses Singapore as the current operator-selected region candidate", () => {
    const toml = read("fly.toml");
    assert.ok(/^primary_region\s*=\s*"sin"/m.test(toml));
  });

  // --- Host-neutral Linux VM path ------------------------------------------

  test("docker-compose.production.yml persistent volume name matches the Fly volume name", () => {
    const compose = read("docker-compose.production.yml");
    assert.ok(compose.includes("repodiet_persistent:/persistent"));
    assert.ok(/^\s*repodiet_persistent:\s*$/m.test(compose), "the named volume must be declared at the bottom-level volumes: key");
  });

  test("docker-compose.production.yml publishes no ports and restarts automatically", () => {
    const compose = read("docker-compose.production.yml");
    assert.ok(!/^\s*ports:/m.test(compose), "must not publish an inbound port for an outbound-only client");
    assert.ok(compose.includes("restart: unless-stopped"));
  });

  test("the host-level systemd unit manages Docker Compose and never runs inside the container", () => {
    const unit = read("deploy/repodiet-seller.service");
    assert.ok(unit.includes("docker compose"), "must drive the same compose file, not a separate deploy mechanism");
    assert.ok(unit.includes("docker-compose.production.yml"));
    assert.ok(unit.includes("WantedBy=multi-user.target"), "must start at boot");
    assert.ok(/Restart=on-failure/.test(unit));
    assert.ok(
      unit.includes("does NOT run inside the container"),
      "must document that this is a host-level unit, not systemd-in-container"
    );
  });

  test("Dockerfile.seller does not install or invoke systemd — supervision is tini + the in-process supervisor only", () => {
    const dockerfile = read("Dockerfile.seller");
    assert.ok(!/\bsystemd\b/i.test(dockerfile), "the image must never install systemd");
    const supervisor = read("scripts/seller-runtime-supervisor.ts");
    // The docblock explains, in prose, why systemctl is unusable in this
    // container (that mention is expected) — the real assertion is that it
    // is never actually invoked as a command.
    assert.ok(
      !/(?:spawn|runProcess)\(\s*["'`]systemctl/.test(supervisor),
      "the supervisor must never shell out to systemctl"
    );
  });

  test("the deploy README documents x86_64 only and does not claim untested arm64 support", () => {
    const readme = read("deploy/README.md");
    assert.ok(/x86_64/.test(readme));
    assert.ok(/arm64/i.test(readme), "must at least address arm64 explicitly rather than staying silent");
    assert.ok(/not (verified|tested)/i.test(readme), "must not claim arm64 support without evidence");
  });

  // --- Cross-file consistency ----------------------------------------------

  test("HOME/XDG_DATA_HOME/REPODIET_OKX_RUNTIME_ROOT agree across Dockerfile.seller and fly.toml", () => {
    const dockerfile = read("Dockerfile.seller");
    const toml = read("fly.toml");
    for (const [dockerfileForm, tomlForm] of [
      ["HOME=/persistent/home", 'HOME = "/persistent/home"'],
      ["XDG_DATA_HOME=/persistent/data", 'XDG_DATA_HOME = "/persistent/data"'],
      [
        "REPODIET_OKX_RUNTIME_ROOT=/persistent/data/okx-runtimes",
        'REPODIET_OKX_RUNTIME_ROOT = "/persistent/data/okx-runtimes"',
      ],
    ]) {
      assert.ok(dockerfile.includes(dockerfileForm), `Dockerfile.seller missing ${dockerfileForm}`);
      assert.ok(toml.includes(tomlForm), `fly.toml missing ${tomlForm}`);
    }
  });

  // --- GitHub Actions Fly deploy workflow ----------------------------------

  test("the Fly deploy workflow only runs after CI succeeds on main, never on this PR's branch", () => {
    const workflow = read(".github/workflows/fly-deploy.yml");
    assert.ok(workflow.includes('workflows: ["CI"]'), "must gate on the real CI workflow completing");
    assert.ok(workflow.includes("branches: [main]"));
    assert.ok(workflow.includes("github.event.workflow_run.conclusion == 'success'"));
    assert.ok(workflow.includes("github.event.workflow_run.head_branch == 'main'"));
  });

  test("the Fly deploy workflow fails clearly instead of silently no-op'ing when FLY_API_TOKEN is missing", () => {
    const workflow = read(".github/workflows/fly-deploy.yml");
    assert.ok(workflow.includes("Require FLY_API_TOKEN"));
    assert.ok(workflow.includes("FLY_API_TOKEN is not configured"));
    assert.ok(/exit 1/.test(workflow));
  });

  test("the Fly deploy workflow never echoes or logs the token value itself", () => {
    const workflow = read(".github/workflows/fly-deploy.yml");
    // Mentioning the *name* FLY_API_TOKEN in a diagnostic string is fine
    // (the "missing token" error does exactly that); interpolating its
    // *value* (${{ secrets.FLY_API_TOKEN }} or $FLY_API_TOKEN) into an
    // echo/print statement is what must never happen.
    assert.ok(
      !/echo[^\n]*(\$\{\{\s*secrets\.FLY_API_TOKEN\s*\}\}|\$FLY_API_TOKEN\b|\$\{FLY_API_TOKEN\})/.test(workflow),
      "must never echo the resolved token value"
    );
    assert.ok(!/set -x/.test(workflow), "must not enable shell command tracing that could leak the token in step output");
  });

  test("the Fly deploy workflow uses --remote-only and prevents overlapping deployments", () => {
    const workflow = read(".github/workflows/fly-deploy.yml");
    assert.ok(workflow.includes("flyctl deploy --remote-only"));
    assert.ok(workflow.includes("cancel-in-progress: false"));
    assert.ok(workflow.includes("group: fly-deploy-repodiet-agent-9636"));
  });

  test("the Fly deploy workflow guards against provisioning a second Machine", () => {
    const workflow = read(".github/workflows/fly-deploy.yml");
    assert.ok(workflow.includes("--ha=false"), "must disable flyctl's default high-availability second-Machine behavior");
    assert.ok(workflow.includes("Verify exactly one Machine exists after deploy"));
    assert.ok(workflow.includes('if [ "${count}" != "1" ]'));
  });

  console.log("fly-and-linux-vm-deployment: all passed");
}

run();
