#!/usr/bin/env node
/**
 * Merge gate for this repository's PRs.
 *
 * === Why this exists ===
 *
 * PR #175 was merged while `typecheck-test-build` and `delivery-okx-contracts`
 * were CANCELLED. The gate in use at the time asked GitHub for the workflow RUN
 * belonging to the branch head and accepted `completed/success` — which is the
 * wrong question in three separate ways:
 *
 *   1. it read a RUN, not the individual required JOBS, so a run whose jobs were
 *      cancelled could still be read as acceptable;
 *   2. it took the first matching run, so with several runs attached to a SHA it
 *      could answer from the wrong one;
 *   3. it treated "not failed" as "passed". CANCELLED, QUEUED, IN_PROGRESS,
 *      SKIPPED and TIMED_OUT are none of them success, and a cancelled job is
 *      the most dangerous of the set because it looks finished.
 *
 * The rule here is deliberately blunt: EVERY check reported for the PR head must
 * be in the `pass` bucket. Anything else — including a check that simply has not
 * reported yet — blocks the merge.
 *
 * Note on GitHub's synthetic merge ref: `pull_request` workflows run against a
 * merge commit, not the raw branch head, so requiring every check to carry the
 * head SHA would wrongly reject a perfectly valid run. `gh pr checks` already
 * resolves checks for the PR's current state, which is the right source. The
 * head SHA is verified separately, before and after, so a push that lands mid-
 * verification invalidates the result instead of sneaking through.
 *
 *   node scripts/ci-merge-gate.mjs <pr-number> [--merge]
 *
 * Exit 0 = every check passed and the head never moved. Non-zero = do not merge.
 */
import { execFileSync } from "node:child_process";

const PASSING_BUCKET = "pass";
/** Buckets that must never be treated as success, with why they are dangerous. */
const BLOCKING = {
  fail: "failed",
  pending: "still queued or in progress — not a result yet",
  cancel: "CANCELLED — looks finished but proved nothing",
  skipping: "skipped — a required job that did not run is not a pass",
};

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

function headSha(pr) {
  return JSON.parse(gh(["pr", "view", String(pr), "--json", "headRefOid"])).headRefOid;
}

function checks(pr) {
  const raw = gh(["pr", "checks", String(pr), "--json", "name,state,bucket,link"]);
  return JSON.parse(raw);
}

function main() {
  const pr = process.argv[2];
  const doMerge = process.argv.includes("--merge");
  if (!pr) {
    console.error("usage: ci-merge-gate.mjs <pr-number> [--merge]");
    process.exit(2);
  }

  const before = headSha(pr);
  let all;
  try {
    all = checks(pr);
  } catch {
    console.error("GATE BLOCKED: no checks reported for this PR yet");
    process.exit(1);
  }

  if (!Array.isArray(all) || all.length === 0) {
    console.error("GATE BLOCKED: zero checks reported — refusing to merge on absence of evidence");
    process.exit(1);
  }

  const failing = all.filter((c) => c.bucket !== PASSING_BUCKET);
  for (const c of all) {
    const mark = c.bucket === PASSING_BUCKET ? "PASS" : "BLOCK";
    console.log(`  ${mark.padEnd(5)} ${String(c.name).padEnd(32)} ${c.state}/${c.bucket}`);
  }

  if (failing.length > 0) {
    console.error(`\nGATE BLOCKED: ${failing.length} check(s) not in the pass bucket`);
    for (const c of failing) {
      console.error(`  - ${c.name}: ${BLOCKING[c.bucket] ?? c.bucket}`);
    }
    process.exit(1);
  }

  // The head must not have moved while the checks above were being read;
  // otherwise the green result belongs to code that is no longer the head.
  const after = headSha(pr);
  if (before !== after) {
    console.error(`\nGATE BLOCKED: head moved ${before} -> ${after} during verification`);
    process.exit(1);
  }

  console.log(`\nGATE PASSED: ${all.length} check(s) green at ${after}`);
  if (doMerge) {
    gh(["pr", "merge", String(pr), "--squash", "--delete-branch"]);
    console.log(`merged PR #${pr} at ${after}`);
  }
}

main();
