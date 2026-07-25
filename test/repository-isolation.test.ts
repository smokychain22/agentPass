import assert from "node:assert/strict";
import { applyRepositoryIdentity } from "../src/lib/github/refresh-repo-identity";
import { storeFindings, getStoredFindings } from "../src/lib/findings/findings-store";
import type { FindingsPayload } from "../src/lib/findings/types";

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      console.error(`  ✗ ${name}`);
      throw err;
    }
  })();
}

function emptyPayload(overrides: {
  scanId: string;
  owner: string;
  name: string;
  branch: string;
  commitSha: string;
}): FindingsPayload {
  return {
    scanId: overrides.scanId,
    repo: {
      owner: overrides.owner,
      name: overrides.name,
      branch: overrides.branch,
      commitSha: overrides.commitSha,
      url: `https://github.com/${overrides.owner}/${overrides.name}`,
    },
    summary: {
      totalFindings: 0,
      duplicateClusters: 0,
      unusedFiles: 0,
      unusedDependencies: 0,
      unusedExports: 0,
      orphanPatterns: 0,
      slopSignals: 0,
      reviewRequired: 0,
      safeCandidates: 0,
      doNotTouch: 0,
    },
    duplicates: [],
    unused: { files: [], dependencies: [], exports: [] },
    orphans: [],
    slopSignals: [],
    riskBuckets: { safeDelete: [], reviewFirst: [], doNotTouch: [] },
    artifacts: { findingsJson: true },
    mode: "live",
    rawToolReports: {
      knip: { status: "ok", sourceMode: "native", report: { issues: [] }, detail: "", durationMs: 0 } as unknown as FindingsPayload["rawToolReports"]["knip"],
      jscpd: { status: "ok", sourceMode: "native", report: { duplicates: [] }, detail: "", durationMs: 0 } as unknown as FindingsPayload["rawToolReports"]["jscpd"],
      madge: { status: "ok", sourceMode: "native", report: { orphans: [], circular: [] }, detail: "", durationMs: 0 } as unknown as FindingsPayload["rawToolReports"]["madge"],
    },
  };
}

console.log("Repository isolation");

async function main() {
  await test("rename with the same immutable GitHub ID is recognized as the same repository", () => {
    const before = emptyPayload({
      scanId: "scan_rename_a",
      owner: "old-owner",
      name: "old-name",
      branch: "main",
      commitSha: "c1",
    });
    const afterRename = applyRepositoryIdentity(before, {
      id: 999111,
      owner: "new-owner",
      name: "new-name",
      fullName: "new-owner/new-name",
      defaultBranch: "main",
    });
    assert.equal(afterRename.repo.githubRepositoryId, 999111);
    assert.equal(afterRename.repo.previousOwner, "old-owner");
    assert.equal(afterRename.repo.previousName, "old-name");
    assert.equal(afterRename.repo.owner, "new-owner");
    assert.equal(afterRename.repo.name, "new-name");
  });

  await test("a different repository that reuses a freed name has a different immutable ID, never merged with the original", () => {
    const originalRepo = applyRepositoryIdentity(
      emptyPayload({ scanId: "scan_orig", owner: "renamed-away", name: "shared-name", branch: "main", commitSha: "c1" }),
      { id: 111, owner: "renamed-away", name: "shared-name", fullName: "renamed-away/shared-name", defaultBranch: "main" }
    );
    // Someone else later claims the freed "shared-name" under a different account.
    const impostorRepo = applyRepositoryIdentity(
      emptyPayload({ scanId: "scan_impostor", owner: "new-claimant", name: "shared-name", branch: "main", commitSha: "c2" }),
      { id: 222, owner: "new-claimant", name: "shared-name", fullName: "new-claimant/shared-name", defaultBranch: "main" }
    );
    assert.notEqual(originalRepo.repo.githubRepositoryId, impostorRepo.repo.githubRepositoryId);
  });

  await test("two repositories with identical relative file paths keep isolated findings records", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "";
    process.env.UPSTASH_REDIS_REST_TOKEN = "";

    const repoA = emptyPayload({ scanId: "scan_isolation_a", owner: "team-a", name: "app", branch: "main", commitSha: "aaa111" });
    const repoB = emptyPayload({ scanId: "scan_isolation_b", owner: "team-b", name: "app", branch: "main", commitSha: "bbb222" });
    repoA.summary.totalFindings = 3;
    repoB.summary.totalFindings = 7;

    await storeFindings(repoA);
    await storeFindings(repoB);

    const reloadedA = await getStoredFindings("scan_isolation_a");
    const reloadedB = await getStoredFindings("scan_isolation_b");

    assert.equal(reloadedA?.repo.owner, "team-a");
    assert.equal(reloadedA?.repo.commitSha, "aaa111");
    assert.equal(reloadedA?.summary.totalFindings, 3);

    assert.equal(reloadedB?.repo.owner, "team-b");
    assert.equal(reloadedB?.repo.commitSha, "bbb222");
    assert.equal(reloadedB?.summary.totalFindings, 7);
  });

  console.log("Repository isolation: all passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
