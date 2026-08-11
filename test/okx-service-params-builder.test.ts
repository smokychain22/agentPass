/**
 * Job 0xba4de4f576f0dbb05b0a88d2d889102dfb134f5e1c901bf0534312daf5d33402
 * has 1 USDT escrowed and is permanently undeliverable because its
 * `--service-params` was hand-typed as `repositoryUrl: <url>; base: ...`
 * instead of the canonical `repository=<url>` token `parseTaskContext`
 * requires. This suite pins the builder that makes that mistake impossible
 * going forward, including a round-trip check against the REAL parser —
 * the two must actually agree, not just look right independently.
 */
import assert from "node:assert/strict";
import { buildRepositoryCleanupServiceParams } from "../src/lib/okx-runtime/service-params-builder";
import { parseTaskContext } from "../src/lib/okx-runtime/task-context-fetcher";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

function run() {
  console.log("okx-service-params-builder");

  test("emits the exact repository= token the parser requires", () => {
    const params = buildRepositoryCleanupServiceParams({
      repositoryUrl: "https://github.com/velz-cmd/repodiet-e2e-test",
    });
    assert.equal(params, "repository=https://github.com/velz-cmd/repodiet-e2e-test");
  });

  test("round-trips through the real parser: build then parse yields the same URL back", () => {
    const params = buildRepositoryCleanupServiceParams({
      repositoryUrl: "https://github.com/velz-cmd/repodiet-e2e-test",
      baseBranch: "repodiet/e2e-seed-51571e8",
      constraints: "only verified-safe changes, no protected/runtime file changes, no auto-merge",
    });
    const context = parseTaskContext(`serviceParams: ${params}\n`);
    assert.equal(context.repositoryUrl, "https://github.com/velz-cmd/repodiet-e2e-test");
  });

  test("the exact hand-typed shape that stranded job 0xba4de4f5... would have been rejected by the builder", () => {
    assert.throws(() =>
      // this is what was actually typed for --service-params: no `repository=` token at all
      buildRepositoryCleanupServiceParams({
        repositoryUrl: "repositoryUrl: https://github.com/velz-cmd/repodiet-e2e-test",
      })
    );
  });

  test("rejects a repository URL with a trailing path or slash rather than silently truncating it", () => {
    assert.throws(() =>
      buildRepositoryCleanupServiceParams({ repositoryUrl: "https://github.com/velz-cmd/repodiet-e2e-test/" })
    );
    assert.throws(() =>
      buildRepositoryCleanupServiceParams({
        repositoryUrl: "https://github.com/velz-cmd/repodiet-e2e-test/tree/main",
      })
    );
  });

  test("rejects a non-GitHub URL rather than emitting an unparseable-by-design repository", () => {
    assert.throws(() =>
      buildRepositoryCleanupServiceParams({ repositoryUrl: "https://gitlab.com/velz-cmd/repodiet-e2e-test" })
    );
  });

  test("baseBranch and constraints are appended but never break the repository= match", () => {
    const params = buildRepositoryCleanupServiceParams({
      repositoryUrl: "https://github.com/my-org/my_repo.js",
      baseBranch: "main",
      constraints: "no auto-merge",
    });
    assert.equal(
      parseTaskContext(params).repositoryUrl,
      "https://github.com/my-org/my_repo.js",
      "a dot inside the repo name must survive despite trailing '; base=...; constraints=...'"
    );
  });

  console.log("okx-service-params-builder: all passed");
}

run();
