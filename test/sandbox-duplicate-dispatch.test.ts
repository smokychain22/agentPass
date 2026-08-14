import assert from "node:assert/strict";

/**
 * Regression for a production defect visible across EVERY GitHub Actions
 * sandbox run to date (worker runs #1/#2/#3 on b05d0ab4, #5/#6 on b2610d70,
 * #7/#8 on e780c00f): each logical sandbox run was dispatched TWICE — same
 * sandboxRunId, different dispatchNonce — producing one green workflow and
 * one red one. The red job died in `claim` with either
 * `Sandbox run is terminal (ready_for_delivery)` or a CLAIMED_BY_OTHER, i.e.
 * it correctly found the work already done and then reported that as a
 * failure.
 *
 * Two separate bugs, pinned separately below.
 *
 * 1. ROOT CAUSE — `shouldDispatchSandboxExecution` had no notion of a claim
 *    lease. Its `isActiveSandboxStatus` guard only lists Vercel Sandbox stage
 *    names (`cloning`, `baseline_verification`, …); an Actions run instead
 *    sits in `starting` from claim until complete, and a GitHub-hosted runner
 *    can stay queued for minutes — well past REDISPATCH_MS (30s). So a second
 *    dispatch fired while a healthy worker was mid-flight.
 *
 * 2. REPORTING — the losing workflow must exit cleanly. A duplicate that
 *    finds the run already claimed or already terminal has nothing to do and
 *    must not paint a red X next to a successful validation. (It must still
 *    NOT mask a real validation failure — that is a different path, asserted
 *    at the bottom.)
 */

process.env.UPSTASH_REDIS_REST_URL = "";
process.env.UPSTASH_REDIS_REST_TOKEN = "";

import { readFileSync } from "node:fs";
import path from "node:path";
import { shouldDispatchSandboxExecution } from "../src/lib/execution/dispatch-sandbox-execution";
import { SANDBOX_CLAIM_LEASE_MS, type SandboxRun } from "../src/lib/execution/sandbox-run-types";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

const LONG_AGO = new Date(Date.now() - 10 * 60_000).toISOString();

function runFixture(overrides: Partial<SandboxRun> = {}): SandboxRun {
  return {
    id: "sandbox_run_fixture",
    cleanupRunId: "cleanup_run_fixture",
    repositoryOwner: "velz-cmd",
    repositoryName: "repodiet-e2e-test",
    branch: "main",
    baseCommitSha: "5df7c518e4ffa5b083ff7f37b91eff45cbcb591b",
    status: "starting",
    // Dispatched and updated long enough ago that the plain time-based
    // redispatch would otherwise definitely fire.
    executionDispatchedAt: LONG_AGO,
    createdAt: LONG_AGO,
    updatedAt: LONG_AGO,
    payload: {
      cleanupRunId: "cleanup_run_fixture",
      repositoryOwner: "velz-cmd",
      repositoryName: "repodiet-e2e-test",
      branch: "main",
      baseCommitSha: "5df7c518e4ffa5b083ff7f37b91eff45cbcb591b",
      repoUrl: "https://github.com/velz-cmd/repodiet-e2e-test",
      edits: [],
      changeOperations: [],
    },
    ...overrides,
  } as SandboxRun;
}

console.log("Sandbox duplicate-dispatch prevention");

test("THE BUG: a run claimed by a live worker is never dispatched again, however long it has been queued", () => {
  const claimed = runFixture({
    claimedBy: "github-actions/ubuntu-latest",
    leaseExpiresAt: new Date(Date.now() + SANDBOX_CLAIM_LEASE_MS).toISOString(),
  });
  assert.equal(
    shouldDispatchSandboxExecution(claimed),
    false,
    "a live claim lease must suppress redispatch — this is what produced the paired green/red runs"
  );
});

test("an UNCLAIMED run past the redispatch window still dispatches (recovery is not broken by the fix)", () => {
  assert.equal(shouldDispatchSandboxExecution(runFixture()), true);
});

test("an EXPIRED lease dispatches again — an abandoned worker must still be recoverable", () => {
  const abandoned = runFixture({
    claimedBy: "github-actions/ubuntu-latest",
    leaseExpiresAt: new Date(Date.now() - 1000).toISOString(),
  });
  assert.equal(
    shouldDispatchSandboxExecution(abandoned),
    true,
    "an expired lease must not permanently wedge a run"
  );
});

test("a claimedBy with no lease at all is treated as not-live, so recovery still works", () => {
  const noLease = runFixture({ claimedBy: "github-actions/ubuntu-latest", leaseExpiresAt: undefined });
  assert.equal(shouldDispatchSandboxExecution(noLease), true);
});

test("a terminal run is never dispatched, claimed or not", () => {
  for (const status of ["ready_for_delivery", "failed", "blocked", "delivered"] as const) {
    assert.equal(shouldDispatchSandboxExecution(runFixture({ status })), false, status);
  }
});

const CLAIM_ROUTE = readFileSync(
  path.join(process.cwd(), "src/app/api/internal/actions/sandbox-runs/claim-exchange/route.ts"),
  "utf8"
);

test("REPORTING: claim-exchange answers a duplicate with a benign already-claimed result, not an error", () => {
  // Both "someone else holds it" and "someone else already finished it" are
  // expected duplicate-dispatch outcomes, so both must return ok:true.
  const branch = CLAIM_ROUTE.match(/if \(claim\.code === [\s\S]{0,400}?\}\s*\n/);
  assert.ok(branch, "could not locate the claim-failure branch");
  assert.match(branch[0], /CLAIMED_BY_OTHER/);
  assert.match(branch[0], /TERMINAL/);
  assert.match(branch[0], /ok:\s*true/);
  assert.match(branch[0], /alreadyClaimed:\s*true/);
});

test("REPORTING: a genuinely unknown run is still a hard error, never silently swallowed", () => {
  assert.match(CLAIM_ROUTE, /ok:\s*false,\s*code:\s*claim\.code/);
  assert.match(CLAIM_ROUTE, /claim\.code === "NOT_FOUND" \? 404 : 409/);
});

const CLAIM_SCRIPT = readFileSync(
  path.join(process.cwd(), "scripts/actions-worker/sandbox-claim.ts"),
  "utf8"
);

test("REPORTING: the claim script exits 0 on already-claimed instead of throwing", () => {
  const guard = CLAIM_SCRIPT.match(/if \(json\.code === "ALREADY_CLAIMED"[\s\S]{0,400}?return;/);
  assert.ok(guard, "expected an ALREADY_CLAIMED early-return in sandbox-claim.ts");
  assert.match(guard[0], /already_claimed/);
  assert.equal(/throw/.test(guard[0]), false, "the already-claimed path must not throw");
});

test("a real claim failure still throws — duplicates are excused, broken claims are not", () => {
  assert.match(CLAIM_SCRIPT, /throw new Error\(json\.error \|\| `claim-exchange failed/);
});

console.log("Sandbox duplicate-dispatch prevention: all passed");
