/**
 * COMMAND 3E, Slice 3 — same-PR repair, replacement-PR rules, and bounded
 * base-branch-moved auto-recovery. Pure unit tests against a fake
 * GitHubClient (no network) — exercises the real decision logic in
 * src/lib/operator/pr-repair.ts and src/lib/operator/cleanup-delivery-guard.ts.
 */
import assert from "node:assert/strict";
import { resolvePrRepairStrategy } from "../src/lib/operator/pr-repair";
import { assertCleanupDeliveryContext } from "../src/lib/operator/cleanup-delivery-guard";
import { hashSource } from "../src/lib/execution/transform-audit";
import type { GitHubClient } from "../src/lib/github/github-client";

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`  ✓ ${name}`))
    .catch((err) => {
      console.error(`  ✗ ${name}`);
      throw err;
    });
}

type FakeClientOverrides = Partial<{
  getBranchSha: (owner: string, repo: string, branch: string) => Promise<string>;
  getPullRequest: (
    owner: string,
    repo: string,
    prNumber: number
  ) => Promise<{ number: number; url: string; state: string }>;
  getFileContent: (owner: string, repo: string, path: string, branch: string) => Promise<string | null>;
  listBranchesWithPrefix: (owner: string, repo: string, prefix: string) => Promise<string[]>;
  listOpenPullRequestsForHeadPrefix: (
    owner: string,
    repo: string,
    prefix: string
  ) => Promise<Array<{ number: number; url: string; head: string }>>;
  getFileSha: (owner: string, repo: string, path: string, branch: string) => Promise<string | null>;
}>;

function fakeClient(overrides: FakeClientOverrides): GitHubClient {
  return {
    getBranchSha: overrides.getBranchSha ?? (async () => { throw new Error("branch not found"); }),
    getPullRequest: overrides.getPullRequest ?? (async () => { throw new Error("pr not found"); }),
    getFileContent: overrides.getFileContent ?? (async () => null),
    listBranchesWithPrefix: overrides.listBranchesWithPrefix ?? (async () => []),
    listOpenPullRequestsForHeadPrefix: overrides.listOpenPullRequestsForHeadPrefix ?? (async () => []),
    getFileSha: overrides.getFileSha ?? (async () => null),
  } as unknown as GitHubClient;
}

async function run() {
  console.log("command3e-slice3-delivery-repair");

  // --- pr-repair.ts -------------------------------------------------------

  await test("first attempt (no existingPrNumber, no branch) creates a new branch and PR", async () => {
    const client = fakeClient({});
    const resolution = await resolvePrRepairStrategy(client, {
      owner: "acme",
      repo: "app",
      cleanupBranch: "repodiet/cleanup-x",
    });
    assert.equal(resolution.action, "create_new_branch_and_pr");
    assert.equal(resolution.branchExists, false);
  });

  await test("retry with an existing open PR and branch reuses the same PR", async () => {
    const client = fakeClient({
      getBranchSha: async () => "sha123",
      getPullRequest: async () => ({
        number: 42,
        url: "https://github.com/acme/app/pull/42",
        headSha: "sha123",
        baseSha: "base1",
        headRef: "repodiet/cleanup-x",
        baseRef: "main",
        state: "open",
      }) as never,
    });
    const resolution = await resolvePrRepairStrategy(client, {
      owner: "acme",
      repo: "app",
      cleanupBranch: "repodiet/cleanup-x",
      existingPrNumber: 42,
    });
    assert.equal(resolution.action, "reuse_existing_branch_and_pr");
    assert.equal(resolution.existingPr?.number, 42);
  });

  await test("a closed original PR requires a replacement, never silently reused", async () => {
    const client = fakeClient({
      getBranchSha: async () => "sha123",
      getPullRequest: async () => ({
        number: 42,
        url: "https://github.com/acme/app/pull/42",
        headSha: "sha123",
        baseSha: "base1",
        headRef: "repodiet/cleanup-x",
        baseRef: "main",
        state: "closed",
      }) as never,
    });
    const resolution = await resolvePrRepairStrategy(client, {
      owner: "acme",
      repo: "app",
      cleanupBranch: "repodiet/cleanup-x",
      existingPrNumber: 42,
    });
    assert.equal(resolution.action, "replacement_required");
    assert.match(resolution.reason, /closed/);
  });

  await test("a deleted/inaccessible original PR requires a replacement", async () => {
    const client = fakeClient({
      getBranchSha: async () => { throw new Error("no branch"); },
      getPullRequest: async () => { throw new Error("404"); },
    });
    const resolution = await resolvePrRepairStrategy(client, {
      owner: "acme",
      repo: "app",
      cleanupBranch: "repodiet/cleanup-x",
      existingPrNumber: 42,
    });
    assert.equal(resolution.action, "replacement_required");
    assert.equal(resolution.branchExists, false);
  });

  await test("a stale branch with no known PR requires a replacement rather than silently resuming", async () => {
    const client = fakeClient({ getBranchSha: async () => "sha123" });
    const resolution = await resolvePrRepairStrategy(client, {
      owner: "acme",
      repo: "app",
      cleanupBranch: "repodiet/cleanup-x",
    });
    assert.equal(resolution.action, "replacement_required");
    assert.equal(resolution.branchExists, true);
  });

  // --- cleanup-delivery-guard.ts base-branch-moved recovery ---------------

  await test("commit matches: no auto-recovery flag, no throw (unchanged prior behavior)", async () => {
    const client = fakeClient({ getBranchSha: async () => "abc123" });
    const result = await assertCleanupDeliveryContext({
      client,
      owner: "acme",
      repo: "app",
      baseBranch: "main",
      scanCommitSha: "abc123",
      validatedEdits: [],
    });
    assert.equal(result.baseAutoRecovered, false);
  });

  await test("base moved, edit-only delivery, all approved files byte-identical on new commit: auto-recovers", async () => {
    const content = "export const a = 1;\n";
    const client = fakeClient({
      getBranchSha: async () => "newcommit456",
      getFileContent: async () => content,
    });
    const result = await assertCleanupDeliveryContext({
      client,
      owner: "acme",
      repo: "app",
      baseBranch: "main",
      scanCommitSha: "oldcommit123",
      validatedEdits: [{ path: "src/a.ts", content, baselineContentHash: hashSource(content) }],
      deletePaths: [],
    });
    assert.equal(result.baseAutoRecovered, true);
    assert.ok(result.warnings.some((w) => /base branch moved/i.test(w)));
  });

  await test("base moved but a delete is involved: never auto-recovers, still hard-fails", async () => {
    const content = "export const a = 1;\n";
    const client = fakeClient({
      getBranchSha: async () => "newcommit456",
      getFileContent: async () => content,
    });
    await assert.rejects(
      assertCleanupDeliveryContext({
        client,
        owner: "acme",
        repo: "app",
        baseBranch: "main",
        scanCommitSha: "oldcommit123",
        validatedEdits: [{ path: "src/a.ts", content, baselineContentHash: hashSource(content) }],
        deletePaths: ["src/b.ts"],
      })
    );
  });

  await test("base moved and an approved file actually changed: never auto-recovers, still hard-fails", async () => {
    const client = fakeClient({
      getBranchSha: async () => "newcommit456",
      getFileContent: async () => "export const a = 2; // changed on GitHub\n",
    });
    await assert.rejects(
      assertCleanupDeliveryContext({
        client,
        owner: "acme",
        repo: "app",
        baseBranch: "main",
        scanCommitSha: "oldcommit123",
        validatedEdits: [
          { path: "src/a.ts", content: "x", baselineContentHash: hashSource("export const a = 1;\n") },
        ],
        deletePaths: [],
      })
    );
  });

  await test("base moved with zero validated edits (report-only): never auto-recovers, still hard-fails", async () => {
    const client = fakeClient({ getBranchSha: async () => "newcommit456" });
    await assert.rejects(
      assertCleanupDeliveryContext({
        client,
        owner: "acme",
        repo: "app",
        baseBranch: "main",
        scanCommitSha: "oldcommit123",
        validatedEdits: [],
        deletePaths: [],
      })
    );
  });

  console.log("command3e-slice3-delivery-repair: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
