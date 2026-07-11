import assert from "node:assert/strict";
import { isRecentRepoInstallBinding } from "../src/lib/github-app/binding-trust";
import type { RepoInstallBinding } from "../src/lib/github-app/install-flow-store";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("resolve-cleanup-token");

test("recent binding authorizes delivery while GitHub propagates repo access", () => {
  const binding: RepoInstallBinding = {
    sessionKey: "1.2.3.4:abc",
    installationId: 145764323,
    installationOwner: "velz-cmd",
    installationOwnerType: "User",
    repositoryFullName: "velz-cmd/Meridian",
    setupAction: "update",
    authorizedAt: new Date().toISOString(),
  };

  assert.equal(isRecentRepoInstallBinding(binding, 145764323), true);
});

test("binding for another installation is not trusted", () => {
  const binding: RepoInstallBinding = {
    sessionKey: "1.2.3.4:abc",
    installationId: 999,
    installationOwner: "velz-cmd",
    installationOwnerType: "User",
    repositoryFullName: "velz-cmd/Meridian",
    authorizedAt: new Date().toISOString(),
  };

  assert.equal(isRecentRepoInstallBinding(binding, 145764323), false);
});

console.log("resolve-cleanup-token: all passed");
