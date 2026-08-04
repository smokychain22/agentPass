/**
 * Regression battery for the repository URL the deterministic turn clones and
 * writes to — the single field this route is never allowed to get wrong.
 *
 * The live defect: buyers write the repository into PROSE, not into a field.
 * Job 0x22a2…'s real task detail reads
 *
 *   "Repository: https://github.com/velz-cmd/repodiet-e2e-test. Do not push
 *    directly to the default branch."
 *
 * `\S+` is greedy to the whitespace, so it captured the sentence period and
 * produced `repo: "repodiet-e2e-test."` — a repository that does not exist.
 * Every GitHub call for that job 404'd, the turn failed, and an accepted,
 * escrow-funded task went undelivered across four separate event lifetimes of
 * 15 attempts each.
 */
import assert from "node:assert/strict";
import { parseTaskContext } from "../src/lib/okx-runtime/task-context-fetcher";
import { parseGitHubUrl } from "../src/lib/github/parse-github-url";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

/** The real `agent common context` output for job 0x22a2…, verbatim. */
const LIVE_CONTEXT = `You are the Agent Service Provider (ASP) in the task system.

[Task Details]
- Job ID: 0x22a216415e2b1176d2111b136584e42fd949f7c0cfca48c657a7d1ca8e6927c6
- Title: RepoDiet Verified Cleanup
- Description: I want RepoDiet to safely analyze my authorized JavaScript/TypeScript repository and create a verified cleanup pull request. Repository: https://github.com/velz-cmd/repodiet-e2e-test. Do not push directly to the default branch.
- Budget: 1 USDT (token: 0x779ded0c9e1022225f8e0630b35a9b54be713736)
- Chain: chainId=196
`;

function run() {
  console.log("okx-task-context-repository-url");

  test("the LIVE task detail resolves to the real repository, not a trailing-period variant", () => {
    const context = parseTaskContext(LIVE_CONTEXT);
    assert.equal(
      context.repositoryUrl,
      "https://github.com/velz-cmd/repodiet-e2e-test",
      "the sentence period must not become part of the repository name"
    );
    const parsed = parseGitHubUrl(context.repositoryUrl!);
    assert.equal(parsed?.owner, "velz-cmd");
    assert.equal(
      parsed?.repo,
      "repodiet-e2e-test",
      "the repo name reaching the GitHub API must be the real one"
    );
  });

  test("every sentence-punctuation ending is trimmed", () => {
    for (const [suffix, note] of [
      [".", "full stop"],
      [",", "comma"],
      [";", "semicolon"],
      [":", "colon"],
      ["!", "exclamation"],
      ["?", "question mark"],
      [")", "closing paren"],
      ["]", "closing bracket"],
      ["...", "ellipsis"],
      [".)", "paren after full stop"],
    ] as const) {
      const context = parseTaskContext(
        `- Description: clean up Repository: https://github.com/velz-cmd/repodiet-e2e-test${suffix} Thanks.`
      );
      assert.equal(
        context.repositoryUrl,
        "https://github.com/velz-cmd/repodiet-e2e-test",
        `must trim ${note}`
      );
    }
  });

  test("a captured URL followed by a closing bracket is trimmed", () => {
    // Note the shape: the parser requires `repository` + `[:\s]+` immediately
    // before the URL, so `repository (https://…)` is not captured at all —
    // a separate parser gap, deliberately not papered over here. What this
    // pins is that a URL which IS captured never keeps a trailing bracket.
    assert.equal(
      parseTaskContext("repository=https://github.com/velz-cmd/repodiet-e2e-test) and thanks")
        .repositoryUrl,
      "https://github.com/velz-cmd/repodiet-e2e-test"
    );
    assert.equal(
      parseTaskContext("Repository: https://github.com/velz-cmd/repodiet-e2e-test].").repositoryUrl,
      "https://github.com/velz-cmd/repodiet-e2e-test"
    );
  });

  test("the serviceParams form — no surrounding prose — is unaffected", () => {
    // This is the form that always worked; trimming must not damage it.
    const context = parseTaskContext(
      "serviceParams: repository=https://github.com/velz-cmd/repodiet-e2e-test\n"
    );
    assert.equal(context.repositoryUrl, "https://github.com/velz-cmd/repodiet-e2e-test");
  });

  test("legitimate URL characters are NOT stripped", () => {
    // A trailing slash is valid and `parseGitHubUrl` handles it; hyphens,
    // underscores and dots INSIDE the name must survive untouched.
    assert.equal(
      parseTaskContext("repository=https://github.com/velz-cmd/repodiet-e2e-test/").repositoryUrl,
      "https://github.com/velz-cmd/repodiet-e2e-test/"
    );
    assert.equal(
      parseTaskContext("repository=https://github.com/my-org/my_repo.js").repositoryUrl,
      "https://github.com/my-org/my_repo.js",
      "a dot INSIDE the repository name is part of the name, not punctuation"
    );
    assert.equal(
      parseTaskContext("repository=https://github.com/my-org/my_repo.js. Done").repositoryUrl,
      "https://github.com/my-org/my_repo.js",
      "…but a sentence period after it still goes"
    );
  });

  test("a missing repository is still undefined — never invented", () => {
    assert.equal(parseTaskContext("- Title: something\n").repositoryUrl, undefined);
    assert.equal(parseTaskContext("").repositoryUrl, undefined);
  });

  test("the other parsed fields still resolve from the live context", () => {
    const context = parseTaskContext(LIVE_CONTEXT);
    assert.equal(context.title, "RepoDiet Verified Cleanup");
    assert.equal(context.tokenAmount, "1");
    assert.equal(context.tokenSymbol, "USDT");
  });

  console.log("okx-task-context-repository-url: all passed");
}

run();
