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
 * The rule is deliberately blunt for every check that GitHub's branch
 * protection actually treats as REQUIRED: it must be in the `pass` bucket.
 * Anything else — including a check that simply has not reported yet —
 * blocks the merge. Required contexts are read from the branch protection API
 * itself (never hardcoded here), so this can never drift from what GitHub
 * will actually enforce server-side.
 *
 * A NON-required check (e.g. a second Vercel project attached to the repo
 * that isn't the production deployment) is still printed for visibility but
 * cannot block the merge — see Incident: `Vercel – workspace` was proven
 * (2026-08-08) to be a non-production project with repeated OOM/queue
 * instability and removed from `main`'s required contexts; a gate that kept
 * requiring 100% of every REPORTED check regardless would then block every
 * future merge on a project nobody decided mattered.
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
 * Exit 0 = every REQUIRED check passed and the head never moved. Non-zero =
 * do not merge.
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

/** Reads REQUIRED status-check contexts straight from branch protection — the single source of truth for what GitHub will actually enforce. */
function requiredContexts(owner, repo, branch) {
  const raw = gh(["api", `repos/${owner}/${repo}/branches/${branch}/protection/required_status_checks`]);
  return new Set(JSON.parse(raw).contexts ?? []);
}

function main() {
  const pr = process.argv[2];
  const doMerge = process.argv.includes("--merge");
  if (!pr) {
    console.error("usage: ci-merge-gate.mjs <pr-number> [--merge]");
    process.exit(2);
  }

  const prInfo = JSON.parse(gh(["pr", "view", String(pr), "--json", "headRefOid,baseRefName"]));
  const before = prInfo.headRefOid;
  const [owner, repo] = gh(["repo", "view", "--json", "owner,name", "-q", ".owner.login + \"/\" + .name"]).trim().split("/");

  let required;
  try {
    required = requiredContexts(owner, repo, prInfo.baseRefName);
  } catch (err) {
    console.error(`GATE BLOCKED: could not read required status checks from branch protection: ${err.message}`);
    process.exit(1);
  }
  if (required.size === 0) {
    console.error("GATE BLOCKED: branch protection reports zero required contexts — refusing to merge on absence of a defined gate");
    process.exit(1);
  }

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

  for (const c of all) {
    const isRequired = required.has(c.name);
    const mark = c.bucket === PASSING_BUCKET ? "PASS" : isRequired ? "BLOCK" : "warn";
    console.log(`  ${mark.padEnd(5)} ${isRequired ? "[required]" : "[optional]"} ${String(c.name).padEnd(32)} ${c.state}/${c.bucket}`);
  }

  const reportedNames = new Set(all.map((c) => c.name));
  const missing = [...required].filter((name) => !reportedNames.has(name));
  const failingRequired = all.filter((c) => required.has(c.name) && c.bucket !== PASSING_BUCKET);

  if (missing.length > 0 || failingRequired.length > 0) {
    console.error(
      `\nGATE BLOCKED: ${failingRequired.length} required check(s) not in the pass bucket, ${missing.length} required check(s) missing entirely`
    );
    for (const c of failingRequired) {
      console.error(`  - ${c.name}: ${BLOCKING[c.bucket] ?? c.bucket}`);
    }
    for (const name of missing) {
      console.error(`  - ${name}: required by branch protection but not reported for this PR`);
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

  console.log(`\nGATE PASSED: ${required.size} required check(s) green at ${after}`);
  if (doMerge) {
    gh(["pr", "merge", String(pr), "--squash", "--delete-branch"]);
    console.log(`merged PR #${pr} at ${after}`);
  }
}

main();
