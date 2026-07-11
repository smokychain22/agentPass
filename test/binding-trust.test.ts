import assert from "node:assert/strict";
import {
  isRecentRepoInstallBinding,
  REPO_INSTALL_BINDING_TRUST_MS,
} from "../src/lib/github-app/binding-trust";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("binding-trust");

test("accepts binding authorized within trust window", () => {
  const ok = isRecentRepoInstallBinding(
    {
      sessionKey: "k",
      installationId: 145764323,
      installationOwner: "velz-cmd",
      installationOwnerType: "Organization",
      repositoryFullName: "velz-cmd/Meridian",
      authorizedAt: new Date().toISOString(),
    },
    145764323
  );
  assert.equal(ok, true);
});

test("rejects binding for different installation", () => {
  const ok = isRecentRepoInstallBinding(
    {
      sessionKey: "k",
      installationId: 1,
      installationOwner: "velz-cmd",
      installationOwnerType: "Organization",
      repositoryFullName: "velz-cmd/Meridian",
      authorizedAt: new Date().toISOString(),
    },
    145764323
  );
  assert.equal(ok, false);
});

test("rejects expired binding", () => {
  const ok = isRecentRepoInstallBinding(
    {
      sessionKey: "k",
      installationId: 145764323,
      installationOwner: "velz-cmd",
      installationOwnerType: "Organization",
      repositoryFullName: "velz-cmd/Meridian",
      authorizedAt: new Date(Date.now() - REPO_INSTALL_BINDING_TRUST_MS - 1000).toISOString(),
    },
    145764323
  );
  assert.equal(ok, false);
});

console.log("binding-trust: all passed");
