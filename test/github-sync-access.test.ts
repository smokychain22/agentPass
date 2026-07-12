import assert from "node:assert/strict";
import { parseInstallCallbackParams } from "../src/lib/github-app/install-callback";
import { resolveGrantPropagationPending } from "../src/lib/github-app/preflight";

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

test("grant propagation pending is false for public repositories", () => {
  assert.equal(
    resolveGrantPropagationPending({
      bindingTrusted: true,
      repositoryAccessible: false,
      suspended: false,
      repositoryIsPublic: true,
      ownerMismatch: false,
    }),
    false
  );
});

test("grant propagation pending is false when installation owner mismatches repo owner", () => {
  assert.equal(
    resolveGrantPropagationPending({
      bindingTrusted: true,
      repositoryAccessible: false,
      suspended: false,
      repositoryIsPublic: false,
      ownerMismatch: true,
    }),
    false
  );
});

test("grant propagation pending stays true only for trusted private grants still propagating", () => {
  assert.equal(
    resolveGrantPropagationPending({
      bindingTrusted: true,
      repositoryAccessible: false,
      suspended: false,
      repositoryIsPublic: false,
      ownerMismatch: false,
    }),
    true
  );
});

console.log("github-sync-access: all passed");
