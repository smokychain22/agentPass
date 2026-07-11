import assert from "node:assert/strict";
import { requiresRepositoryOwnerInstall } from "../src/lib/github-app/repository";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("github-repo-access");

test("personal installation can target org-owned repository names", () => {
  const mismatch = requiresRepositoryOwnerInstall({
    repositoryOwner: "velz-cmd",
    installationOwner: "smokychain22",
  });
  assert.equal(mismatch, true);
});

test("same owner installation is not flagged as owner mismatch", () => {
  const mismatch = requiresRepositoryOwnerInstall({
    repositoryOwner: "velz-cmd",
    installationOwner: "velz-cmd",
  });
  assert.equal(mismatch, false);
});

console.log("github-repo-access: all passed");
