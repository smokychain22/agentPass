import assert from "node:assert/strict";
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

console.log("authoritative-github-access: all passed");
