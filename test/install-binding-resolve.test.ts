import assert from "node:assert/strict";
import {
  resolveRepoInstallBinding,
  saveRepoInstallBinding,
} from "../src/lib/github-app/install-flow-store";

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`  ✓ ${name}`))
    .catch((err) => {
      console.error(`  ✗ ${name}`);
      throw err;
    });
}

console.log("install-binding-resolve");

void test("falls back to installation-scoped binding when session key differs", async () => {
  await saveRepoInstallBinding({
    sessionKey: "old-ip:session-a",
    installationId: 42,
    installationOwner: "velz-cmd",
    installationOwnerType: "User",
    repositoryFullName: "velz-cmd/Meridian",
    setupAction: "update",
    authorizedAt: new Date().toISOString(),
  });

  const resolved = await resolveRepoInstallBinding({
    sessionKey: "new-ip:session-b",
    installationId: 42,
    repositoryFullName: "velz-cmd/Meridian",
  });

  assert.equal(resolved?.installationId, 42);
  assert.equal(resolved?.repositoryFullName, "velz-cmd/Meridian");
}).then(() => {
  console.log("install-binding-resolve: all passed");
});
