import assert from "node:assert/strict";
import { isPublicGitHubRepository } from "../src/lib/github/fetch-repo-zip";

async function testVelzE2eRepoIsPublic(): Promise<void> {
  const isPublic = await isPublicGitHubRepository("velz-cmd", "repodiet-e2e-test");
  assert.equal(isPublic, true, "velz-cmd/repodiet-e2e-test should be public for scan-compatible sandbox clone");
}

testVelzE2eRepoIsPublic()
  .then(() => console.log("public-clone.test.ts: ok"))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
