import assert from "node:assert/strict";
import { parseInstallCallbackParams } from "../src/lib/github-app/install-callback";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("github-sync-access");

test("install callback accepts update action for configure flow", () => {
  const parsed = parseInstallCallbackParams(
    new URLSearchParams({
      installation_id: "145764323",
      setup_action: "update",
      state: "opaque-state-token",
    })
  );
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.params.installationId, 145764323);
    assert.equal(parsed.params.setupAction, "update");
  }
});

console.log("github-sync-access: all passed");
