import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseInstallCallbackParams } from "../src/lib/github-app/install-callback";
import { installationIdLastFour } from "../src/lib/github-app/authoritative-access";
import { canonicalAppOrigin } from "../src/lib/payment/canonical-app-url";
import { REPODIET_PRODUCTION_FALLBACK_URL } from "../src/lib/app/production-url";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("authoritative-github-access");

test("install callback accepts github_installation_id alias", () => {
  const parsed = parseInstallCallbackParams(
    new URLSearchParams({
      github_installation_id: "145764323",
      setup_action: "update",
      state: "opaque-state-token",
    })
  );
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.params.installationId, 145764323);
  }
});

test("installationIdLastFour only exposes last four digits", () => {
  assert.equal(installationIdLastFour(145764323), "4323");
  assert.equal(installationIdLastFour(42), "42");
});

test("canonical production fallback matches REPODIET_PRODUCTION_FALLBACK_URL", () => {
  const prev = process.env.NEXT_PUBLIC_APP_URL;
  const prevVercel = process.env.VERCEL_ENV;
  delete process.env.NEXT_PUBLIC_APP_URL;
  process.env.VERCEL_ENV = "production";
  try {
    assert.equal(canonicalAppOrigin(), REPODIET_PRODUCTION_FALLBACK_URL);
    assert.equal(canonicalAppOrigin(), "https://skillswap-virid-kappa.vercel.app");
  } finally {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = prev;
    if (prevVercel === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = prevVercel;
  }
});

// --- Incident #15: app-level requests were never authenticated, so
// installation discovery always reported a genuinely-installed repository
// as "not_installed" ---------------------------------------------------

test("Incident #15: app-level Octokit uses the documented authStrategy form, not the raw strategy as `auth`", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "src", "lib", "github-app", "octokit.ts"),
    "utf8"
  );
  const start = src.indexOf("export function getAppOctokit(");
  assert.ok(start > -1);
  const body = src.slice(start, src.indexOf("\n}\n", start));
  assert.ok(
    body.includes("authStrategy: createAppAuth"),
    "@octokit/auth-app requires authStrategy alongside auth; without it the strategy is never invoked and every app-level request goes out unauthenticated"
  );
  assert.ok(
    !/new Octokit\(\{\s*auth\s*\}\)/.test(body),
    "passing the strategy instance as `auth` is the exact defect that made apps.listInstallations fail"
  );
  assert.ok(
    body.includes("appId") && body.includes("privateKey"),
    "auth must carry the app credentials as strategy options"
  );
});

test("Incident #15: a failed installation scan is reported, never silently turned into 'not installed'", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "src", "lib", "github-app", "authoritative-repository-access.ts"),
    "utf8"
  );
  const start = src.indexOf("async function paginateInstallationForRepository(");
  assert.ok(start > -1);
  const body = src.slice(start, src.indexOf("\n}\n", start));
  assert.ok(
    !/\}\s*catch\s*\{\s*\n\s*return undefined;/.test(body),
    "a bare catch made a broken auth config indistinguishable from an uninstalled repository"
  );
  assert.ok(
    body.includes("installation_scan_failed"),
    "the failure must surface a diagnostic event"
  );
  assert.ok(
    !body.includes("${err}") && body.includes("err instanceof Error ? err.message"),
    "only the error message may be logged — never a serialized error that could carry token or key material"
  );
});

console.log("authoritative-github-access: all passed");
